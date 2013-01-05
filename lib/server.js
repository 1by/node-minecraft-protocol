var net = require('net')
  , EventEmitter = require('events').EventEmitter
  , util = require('util')
  , assert = require('assert')
  , Client = require('./client')

module.exports = Server;

function Server(options) {
  EventEmitter.call(this);

  this.maxPlayers = options['max-players'] || 20;
  this.playerCount = 0

  this.socketServer = null;
  this.cipher = null;
  this.decipher = null;
  this.clients = {};
}
util.inherits(Server, EventEmitter);

Server.prototype.listen = function(port, host) {
  var self = this;
  var nextId = 0;
  self.socketServer = net.createServer();
  self.socketServer.on('connection', function(socket) {
    var client = new Client({
      isServer: true,
    });
    client.id = nextId++;
    self.clients[client.id] = client;
    client.on('error', function(err) {
      self.emit('error', err);
    });
    client.setSocket(socket);
    self.emit('connection', client);
    client.on('end', function() {
      delete self.clients[client.id];
      this.playerCount -= 1;
    });
    this.playerCount += 1;
  });
  self.socketServer.on('error', function(err) {
    self.emit('error', err);
  });
  self.socketServer.on('close', function() {
    self.emit('close');
  });
  self.socketServer.on('listening', function() {
    self.emit('listening');
  });
  self.socketServer.listen(port, host);
};

Server.prototype.close = function() {
  var client;
  for(var clientId in this.clients) {
    client = this.clients[clientId];
    client.end();
  }
  this.socketServer.close();
};
