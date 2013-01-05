# minecraft protocol

Parse and serialize minecraft packets, plus authentication and encryption.

## Features

 * Parses all packets and emits `packet` events with packet fields as JavaScript
   objects.
 * Send a packet by supplying fields as a JavaScript object.
 * Supports authenticating and logging in.
   - Supports encryption (client only)
   - Supports online mode (client only)
   - Supports offline mode
 * Respond to keep-alive packets.
 * Test coverage
   - encryption
   - authentication/online mode
   - offline mode
   - initialization packets
 * Optimized for rapidly staying up to date with Minecraft protocol updates.

## Minecraft Compatibility

Supports Minecraft version 1.4.7pre

## Usage

### Echo client example

```js
var mc = require('minecraft-protocol');
var client = mc.createClient({
  host: "localhost", // optional
  port: 25565,       // optional
  username: "player",
  email: "email@example.com", // email and password are required only for
  password: "12345678",       // online-mode=true servers
});
client.on(0x03, function(packet) {
  // Listen for chat messages and echo them back.
  if (packet.message.indexOf(client.session.username) !== -1) return;
  client.write(0x03, {
    message: packet.message,
  });
});
```

### Hello World server example

```js
var mc = require('minecraft-protocol');
var server = mc.createServer({
  'online-mode': true,   // optional
  encryption: true,      // optional
  host: '0.0.0.0',       // optional
  port: 25565,           // optional
});
server.on('login', function(client) {
  client.write(0x01, {
    entityId: client.id,
    levelType: 'default',
    gameMode: 0,
    dimension: 0,
    difficulty: 2,
    maxPlayers: server.maxPlayers
  });
  client.write(0x0d, {
    x: 0,
    y: 1.62,
    stance: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    onGround: true
  });
  client.write(0x03, { message: 'Hello, ' + client.username });
});
```

## Testing

* Ensure your system has the `java` executable in `PATH`.
* Download the appropriate version of `minecraft_server.jar`.
* `MC_SERVER_JAR=path/to/minecraft_server.jar MC_USERNAME=username MC_EMAIL=email@example.com MC_PASSWORD=password npm test`

## Updating to a newer protocol version

In most cases you should only have to do the following:

1. In `packets.json`:
 * Update `protocolVersion` to the correct number.
 * Edit the data structure to reflect the new packet layout.
2. Update the "Minecraft Compatibility" section above in this README.
3. Run the test suite to make sure everything still works. See "Testing" above.
