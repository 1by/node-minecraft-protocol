var mc = require('../')
  , protocol = mc.protocol
  , Client = mc.Client
  , Server = mc.Server
  , spawn = require('child_process').spawn
  , path = require('path')
  , fs = require('fs')
  , net = require('net')
  , assert = require('assert')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , Batch = require('batch')
  , zfill = require('zfill')
  , MC_SERVER_JAR = process.env.MC_SERVER_JAR
  , SURVIVE_TIME = 10000
  , MC_SERVER_PATH = path.join(__dirname, 'server')

var defaultServerProps = {
  'generator-settings': "",
  'allow-nether': 'true',
  'level-name': 'world',
  'enable-query': 'false',
  'allow-flight': 'false',
  'server-port': '25565',
  'level-type': 'DEFAULT',
  'enable-rcon': 'false',
  'level-seed': "",
  'server-ip': "",
  'max-build-height': '256',
  'spawn-npcs': 'true',
  'white-list': 'false',
  'spawn-animals': 'true',
  'snooper-enabled': 'true',
  'hardcore': 'false',
  'texture-pack': '',
  'online-mode': 'true',
  'pvp': 'true',
  'difficulty': '1',
  'gamemode': '0',
  'max-players': '20',
  'spawn-monsters': 'true',
  'generate-structures': 'true',
  'view-distance': '10',
  'spawn-protection': '16',
  'motd': 'A Minecraft Server',
};

var eq = assert.strictEqual;
var ok = assert.ok;
var noop = function(){};

var values = {
  'int': [123456, eq],
  'short': [-123, eq],
  'ushort': [123, eq],
  'byte': [-10, eq],
  'ubyte': [8, eq],
  'string': ["hi hi this is my string", eq],
  'byteArray16': [new Buffer(8), ok],
  'bool': [true, eq],
  'double': [99999.2222, eq],
  'float': [-333.444, eq],
  'slot': [{
    id: 5,
    itemCount: 56,
    itemDamage: 2,
    nbtData: new Buffer(90),
  }, ok],

  'ascii': ["hello", eq],
  'byteArray32': [new Buffer(10), ok],
  'long': [[0, 1], ok],
  'slotArray': [[{
    id: 41,
    itemCount: 2,
    itemDamage: 3,
    nbtData: new Buffer(0),
  }], ok],
  'mapChunkBulk': [{
    skyLightSent: true,
    compressedChunkData: new Buffer(1234),
    meta: [{
      x: 23,
      z: 64,
      bitMap: 3,
      addBitMap: 10,
    }],
  }, ok],
  'entityMetadata': [{}, ok],
  'objectData': [{
    intField: 9,
    velocityX: 1,
    velocityY: 2,
    velocityZ: 3,
  }, ok],
  'intArray8': [[1, 2, 3, 4], ok],
  'intVector': [{x: 1, y: 2, z: 3}, ok],
  'byteVector': [{x: 1, y: 2, z: 3}, ok],
  'byteVectorArray': [[{x: 1, y: 2, z: 3}], ok],
}

describe("packets", function() {
  var client, server, serverClient;
  before(function(done) {
    server = new Server();
    server.once('listening', function() {
      server.once('connection', function(c) {
        serverClient = c;
        done();
      });
      client = new Client();
      client.setSocket(net.connect(25565, 'localhost'));
    });
    server.listen(25565, 'localhost');
  });
  after(function(done) {
    client.on('end', function() {
      server.on('close', done);
      server.close();
    });
    client.end();
  });
  var packetId, packetInfo, field;
  for(packetId in protocol.packets) {
    packetId = parseInt(packetId, 10);
    packetInfo = protocol.packets[packetId];
    it("0x" + zfill(parseInt(packetId, 10).toString(16), 2), callTestPacket(packetId, packetInfo));
  }
  function callTestPacket(packetId, packetInfo) {
    return function(done) {
      var batch = new Batch();
      batch.push(function(done) {
        testPacket(packetId, protocol.get(packetId, false), done);
      });
      batch.push(function(done) {
        testPacket(packetId, protocol.get(packetId, true), done);
      });
      batch.end(done);
    };
  }
  function testPacket(packetId, packetInfo, done) {
    // empty object uses default values
    var packet = {};
    packetInfo.forEach(function(field) {
      var value = field.type;
      packet[field.name] = values[field.type][0];
    });
    serverClient.once(packetId, function(receivedPacket) {
      delete receivedPacket.id;
      assertPacketsMatch(packet, receivedPacket);
      client.once(packetId, function(clientReceivedPacket) {
        delete clientReceivedPacket.id;
        assertPacketsMatch(receivedPacket, clientReceivedPacket);
        done();
      });
      serverClient.write(packetId, receivedPacket);
    });
    client.write(packetId, packet);
  }
  function assertPacketsMatch(p1, p2) {
    packetInfo.forEach(function(field) {
      var cmp = values[field.type][1];
      cmp(p1[field], p2[field]);
    });
    var field, cmp;
    for (field in p1) {
      assert.ok(field in p2, "field " + field + " missing in p2");
    }
    for (field in p2) {
      assert.ok(field in p1, "field " + field + " missing in p1");
    }
  }
});

describe("client", function() {
  this.timeout(20000);

  var mcServer;
  function startServer(propOverrides, done) {
    var props = {};
    var prop;
    for (prop in defaultServerProps) {
      props[prop] = defaultServerProps[prop];
    }
    for (prop in propOverrides) {
      props[prop] = propOverrides[prop];
    }
    var batch = new Batch();
    batch.push(function(cb) { mkdirp(MC_SERVER_PATH, cb); });
    batch.push(function(cb) {
      var str = "";
      for (var prop in props) {
        str += prop + "=" + props[prop] + "\n";
      }
      fs.writeFile(path.join(MC_SERVER_PATH, "server.properties"), str, cb);
    });
    batch.end(function(err) {
      if (err) return done(err);
      mcServer = spawn('java', [ '-jar', MC_SERVER_JAR, 'nogui'], {
        stdio: 'pipe',
        cwd: MC_SERVER_PATH,
      });
      mcServer.stdin.setEncoding('utf8');
      mcServer.stdout.setEncoding('utf8');
      mcServer.stderr.setEncoding('utf8');
      var buffer = "";
      mcServer.stdout.on('data', onData);
      mcServer.stderr.on('data', onData);
      function onData(data) {
        buffer += data;
        var lines = buffer.split("\n");
        var len = lines.length - 1;
        for (var i = 0; i < len; ++i) {
          mcServer.emit('line', lines[i]);
        }
        buffer = lines[lines.length - 1];
      }
      mcServer.on('line', onLine);
      mcServer.on('line', function(line) {
        process.stderr.write('.');
        // uncomment this line when debugging for more insight as to what is
        // happening on the minecraft server
        //console.error("[MC]", line);
      });
      function onLine(line) {
        if (/\[INFO\] Done/.test(line)) {
          mcServer.removeListener('line', onLine);
          done();
        }
      }
    });
  }
  afterEach(function(done) {
    mcServer.stdin.write("stop\n");
    mcServer.on('exit', function() {
      mcServer = null;
      done();
    });
  });
  after(function(done) {
    rimraf(MC_SERVER_PATH, done);
  });
  it("pings the server", function(done) {
    startServer({
      motd: 'test1234',
      'max-players': 120,
    }, function() {
      mc.ping({}, function(err, results) {
        if (err) return done(err);
        assert.deepEqual(results, {
          prefix: "§1",
          protocol: protocol.version,
          version: protocol.minecraftVersion,
          motd: 'test1234',
          playerCount: 0,
          maxPlayers: 120
        });
        done();
      });
    });
  });
  it("connects successfully - online mode", function(done) {
    startServer({ 'online-mode': 'true' }, function() {
      var client = mc.createClient({
        username: process.env.MC_USERNAME,
        email: process.env.MC_EMAIL,
        password: process.env.MC_PASSWORD,
      });
      mcServer.on('line', function(line) {
        var match = line.match(/\[INFO\] <(.+?)> (.+)$/);
        if (! match) return;
        assert.strictEqual(match[1], client.session.username);
        assert.strictEqual(match[2], "hello everyone; I have logged in.");
        mcServer.stdin.write("say hello\n");
      });
      var chatCount = 0;
      client.on(0x01, function(packet) {
        assert.strictEqual(packet.levelType, 'default');
        assert.strictEqual(packet.difficulty, 1);
        assert.strictEqual(packet.dimension, 0);
        assert.strictEqual(packet.gameMode, 0);
        client.write(0x03, {
          message: "hello everyone; I have logged in."
        });
      });
      client.on(0x03, function(packet) {
        chatCount += 1;
        assert.ok(chatCount <= 2);
        if (chatCount === 1) {
          assert.strictEqual(packet.message, "<" + client.session.username + ">" + " hello everyone; I have logged in.");
        } else if (chatCount === 2) {
          assert.strictEqual(packet.message, "[Server] hello");
          done();
        }
      });
    });
  });
  it("connects successfully - offline mode", function(done) {
    startServer({ 'online-mode': 'false' }, function() {
      var client = mc.createClient({
        username: process.env.MC_USERNAME,
      });
      mcServer.on('line', function(line) {
        var match = line.match(/\[INFO\] <(.+?)> (.+)$/);
        if (! match) return;
        assert.strictEqual(match[1], process.env.MC_USERNAME);
        assert.strictEqual(match[2], "hello everyone; I have logged in.");
        mcServer.stdin.write("say hello\n");
      });
      var chatCount = 0;
      client.on(0x01, function(packet) {
          assert.strictEqual(packet.levelType, 'default');
          assert.strictEqual(packet.difficulty, 1);
          assert.strictEqual(packet.dimension, 0);
          assert.strictEqual(packet.gameMode, 0);
          client.write(0x03, {
            message: "hello everyone; I have logged in."
          });
      });
      client.on(0x03, function(packet) {
        chatCount += 1;
        assert.ok(chatCount <= 2);
        if (chatCount === 1) {
          assert.strictEqual(packet.message, "<" + process.env.MC_USERNAME + ">" + " hello everyone; I have logged in.");
        } else if (chatCount === 2) {
          assert.strictEqual(packet.message, "[Server] hello");
          done();
        }
      });
    });
  });
  it("gets kicked when no credentials supplied in online mode", function(done) {
    startServer({ 'online-mode': 'true' }, function() {
      var client = mc.createClient({
        username: process.env.MC_USERNAME,
      });
      var gotKicked = false;
      client.on(0xff, function(packet) {
        assert.strictEqual(packet.reason, "Failed to verify username!");
        gotKicked = true;
      });
      client.on('end', function() {
        assert.ok(gotKicked);
        done();
      });
    });
  });
  it("does not crash for " + SURVIVE_TIME + "ms", function(done) {
    startServer({ 'online-mode': 'false' }, function() {
      var client = mc.createClient({
        username: process.env.MC_USERNAME,
      });
      client.on(0x01, function(packet) {
        client.write(0x03, {
          message: "hello everyone; I have logged in."
        });
      });
      client.on(0x03, function(packet) {
        assert.strictEqual(packet.message, "<" + process.env.MC_USERNAME + ">" + " hello everyone; I have logged in.");
        setTimeout(function() {
          done();
        }, SURVIVE_TIME);
      });
    });
  });
});
describe("mc-server", function() {
  it("starts listening and shuts down cleanly", function(done) {
    var server = mc.createServer({ 'online-mode': false });
    var listening = false;
    server.on('listening', function() {
      listening = true;
      server.close();
    });
    server.on('close', function() {
      assert.ok(listening);
      done();
    });
  });
  it("kicks clients that do not log in", function(done) {
    var server = mc.createServer({
      'online-mode': false,
      kickTimeout: 100,
      checkTimeoutInterval: 10,
    });
    var count = 2;
    server.on('connection', function(client) {
      client.on('end', function(reason) {
        assert.strictEqual(reason, "LoginTimeout");
        server.close();
      });
    });
    server.on('close', function() {
      resolve();
    });
    server.on('listening', function() {
      var client = new mc.Client();
      client.on('end', function() {
        resolve();
      });
      client.connect(25565, 'localhost');
    });

    function resolve() {
      count -= 1;
      if (count <= 0) done();
    }
  });
  it("kicks clients that do not send keepalive packets", function(done) {
    var server = mc.createServer({
      'online-mode': false,
      kickTimeout: 100,
      checkTimeoutInterval: 10,
    });
    var count = 2;
    server.on('connection', function(client) {
      client.on('end', function(reason) {
        assert.strictEqual(reason, "KeepAliveTimeout");
        server.close();
      });
    });
    server.on('close', function() {
      resolve();
    });
    server.on('listening', function() {
      var client = mc.createClient({
        username: 'superpants',
        keepAlive: false,
      });
      client.on('end', function() {
        resolve();
      });
    });
    function resolve() {
      count -= 1;
      if (count <= 0) done();
    }
  });
  it("responds to ping requests", function(done) {
    var server = mc.createServer({
      'online-mode': false,
      motd: 'test1234',
      'max-players': 120,
    });
    server.on('listening', function() {
      mc.ping({}, function(err, results) {
        if (err) return done(err);
        assert.deepEqual(results, {
          prefix: "§1",
          protocol: protocol.version,
          version: protocol.minecraftVersion,
          motd: 'test1234',
          playerCount: 0,
          maxPlayers: 120
        });
        server.close();
      });
    });
    server.on('close', done);
  });
  it("clients can log in and chat", function(done) {
    var server = mc.createServer({ 'online-mode': false, });
    var username = ['player1', 'player2'];
    var index = 0;
    server.on('login', function(client) {
      assert.notEqual(client.id, null);
      assert.strictEqual(client.username, username[index++]);
      broadcast(client.username + ' joined the game.');
      client.on('end', function() {
        broadcast(client.username + ' left the game.', client);
        if (client.username === 'player2') server.close();
      });
      client.write(0x01, {
        entityId: client.id,
        levelType: 'default',
        gameMode: 1,
        dimension: 0,
        difficulty: 2,
        maxPlayers: server.maxPlayers
      });
      client.on(0x03, function(packet) {
        var message = '<' + client.username + '>' + ' ' + packet.message;
        broadcast(message);
      });
    });
    server.on('close', done);
    server.on('listening', function() {
      var player1 = mc.createClient({ username: 'player1' });
      player1.on(0x01, function(packet) {
        assert.strictEqual(packet.gameMode, 1);
        assert.strictEqual(packet.levelType, 'default');
        assert.strictEqual(packet.dimension, 0);
        assert.strictEqual(packet.difficulty, 2);
        player1.once(0x03, function(packet) {
          assert.strictEqual(packet.message, 'player2 joined the game.');
          player1.once(0x03, function(packet) {
            assert.strictEqual(packet.message, '<player2> hi');
            player2.once(0x03, fn);
            function fn(packet) {
              if (/^<player2>/.test(packet.message)) {
                player2.once(0x03, fn);
                return;
              }
              assert.strictEqual(packet.message, '<player1> hello');
              player1.once(0x03, function(packet) {
                assert.strictEqual(packet.message, 'player2 left the game.');
                player1.end();
              });
              player2.end();
            }
            player1.write(0x03, { message: "hello" } );
          });
          player2.write(0x03, { message: "hi" } );
        });
        var player2 = mc.createClient({ username: 'player2' });
      });
    });

    function broadcast(message, exclude) {
      var client;
      for (var clientId in server.clients) {
        client = server.clients[clientId];
        if (client !== exclude) client.write(0x03, { message: message });
      }
    }
  });
  it("gives correct reason for kicking clients when shutting down", function(done) {
    var server = mc.createServer({ 'online-mode': false, });
    var count = 2;
    server.on('login', function(client) {
      client.on('end', function(reason) {
        assert.strictEqual(reason, 'ServerShutdown');
        resolve();
      });
      client.write(0x01, {
        entityId: client.id,
        levelType: 'default',
        gameMode: 1,
        dimension: 0,
        difficulty: 2,
        maxPlayers: server.maxPlayers
      });
    });
    server.on('close', function() {
      resolve();
    });
    server.on('listening', function() {
      var client = mc.createClient({ username: 'lalalal', });
      client.on(0x01, function() {
        server.close();
      });
    });
    function resolve() {
      count -= 1;
      if (count <= 0) done();
    }
  });
});
