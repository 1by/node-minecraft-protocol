const net = require('net')
const dns = require('dns')

module.exports = function (client, options) {
  options.port = options.port || 25565
  options.host = options.host || 'localhost'

  if (!options.connect) {
    options.connect = (client) => {
      if (options.stream) {
        client.setSocket(options.stream)
        client.emit('connect')
      } else if (options.port === 25565 && net.isIP(options.host) === 0 && options.host !== 'localhost') {
        dns.resolveSrv('_minecraft._tcp.' + options.host, function (err, addresses) {
          if (err) {
            client.setSocket(net.connect(options.port, options.host))
            return;
          }
          if (addresses && addresses.length > 0) {
            client.setSocket(net.connect(addresses[0].port, addresses[0].name))
            return;
          }
          client.emit('error', 'Could not resolve server address');
          
        })
      } else {
        client.setSocket(net.connect(options.port, options.host))
      }
    }
  }
}
