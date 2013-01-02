var net = require('net')
  , EventEmitter = require('events').EventEmitter
  , util = require('util')
  , assert = require('assert')
  , Iconv = require('iconv').Iconv
  , packets = require('../packets.json')
  , toUcs2 = new Iconv('UTF-8', 'utf16be')
  , fromUcs2 = new Iconv('utf16be', 'UTF-8')

require('buffer-more-ints');

module.exports = Parser;

function Parser(options) {
  EventEmitter.call(this);

  this.client = null;
  this.encryptionEnabled = false;
  this.cipher = null;
  this.decipher = null;
}
util.inherits(Parser, EventEmitter);

Parser.prototype.connect = function(port, host) {
  var self = this;
  self.client = net.connect(port, host, function() {
    self.emit('connect');
  });
  var incomingBuffer = new Buffer(0);
  self.client.on('data', function(data) {
    if (self.encryptionEnabled) data = new Buffer(self.decipher.update(data), 'binary');
    incomingBuffer = Buffer.concat([incomingBuffer, data]);
    var parsed;
    while (true) {
      parsed = parsePacket(incomingBuffer);
      if (! parsed) break;
      incomingBuffer = incomingBuffer.slice(parsed.size);
      self.emit('packet', parsed.results);
    }
  });

  self.client.on('error', function(err) {
    self.emit('error', err);
  });

  self.client.on('end', function() {
    self.emit('end');
  });
};

Parser.prototype.end = function() {
  this.client.end();
};

Parser.prototype.writePacket = function(packetId, params) {
  var buffer = createPacketBuffer(packetId, params);
  var out = this.encryptionEnabled ? new Buffer(this.cipher.update(buffer), 'binary') : buffer;
  if (this.encryptionEnabled) console.log("writing", packetId, "packet with encryption");
  this.client.write(out);
};

var writers = {
  'int': IntWriter,
  'byte': ByteWriter,
  'ubyte': UByteWriter,
  'string': StringWriter,
  'byteArray': ByteArrayWriter,
};

var readers = {
  'string': readString,
  'byteArray': readByteArray,
  'bigByteArray': readBigByteArray,
  'short': readShort,
  'ushort': readUShort,
  'int': readInt,
  'byte': readByte,
  'ubyte': readUByte,
  'long': readLong,
  'slot': readSlot,
  'bool': readBool,
  'double': readDouble,
  'float': readFloat,
  'slotArray': readSlotArray,
  'mapChunkBulk': readMapChunkBulk,
  'entityMetadata': readEntityMetadata,
  'objectData': readObjectData,
  'intArray': readIntArray,
  'intVector': readIntVector,
  'byteVector': readByteVector,
  'byteVectorArray': readByteVectorArray,
};

function readIntArray(buffer, offset) {
  var results = readByte(buffer, offset);
  if (! results) return null;
  var count = results.value;
  var cursor = offset + results.size;

  var endCursor = cursor + 4 * count;
  if (endCursor > buffer.length) return null;
  var array = [];
  for (var i = 0; i < count; ++i) {
    array.push(buffer.readInt32BE(cursor));
    cursor += 4;
  }

  return {
    value: array,
    size: endCursor - offset,
  };
}

var entityMetadataReaders = {
  0: readByte,
  1: readShort,
  2: readInt,
  3: readFloat,
  4: readString,
  5: readSlot,
  6: readIntVector,
};

function readByteVectorArray(buffer, offset) {
  var results = readInt(buffer, offset);
  if (! results) return null;
  var count = results.value;
  var cursor = offset + results.size;
  var cursorEnd = cursor + 3 * count;
  if (cursorEnd > buffer.length) return null;

  var array = [];
  for (var i = 0; i < count; ++i) {
    array.push({
      x: buffer.readInt8(cursor),
      y: buffer.readInt8(cursor + 1),
      z: buffer.readInt8(cursor + 2),
    });
    cursor += 3;
  }
  return {
    value: array,
    size: cursorEnd - offset,
  };
}

function readByteVector(buffer, offset) {
  if (offset + 3 > buffer.length) return null;
  return {
    value: {
      x: buffer.readInt8(offset),
      y: buffer.readInt8(offset + 1),
      z: buffer.readInt8(offset + 2),
    },
    size: 3,
  };
}

function readIntVector(buffer, offset) {
  if (offset + 12 > buffer.length) return null;
  return {
    value: {
      x: buffer.readInt32BE(offset),
      y: buffer.readInt32BE(offset + 4),
      z: buffer.readInt32BE(offset + 8),
    },
    size: 12,
  };
}

function readEntityMetadata(buffer, offset) {
  var cursor = offset;
  var metadata = {};
  var item, key, type, results;
  while (true) {
    if (cursor + 1 > buffer.length) return null;
    item = buffer.readUInt8(cursor);
    cursor += 1;
    if (item === 0x7f) break;
    key = item & 0x1f;
    type = item >> 5;
    reader = entityMetadataReaders[type];
    assert.ok(reader, "missing reader for entity metadata type " + type);
    results = reader(buffer, cursor);
    if (! results) return null;
    metadata[key] = results.value;
    cursor += results.size;
  }
  return {
    value: metadata,
    size: cursor - offset,
  };
}

function readObjectData(buffer, offset) {
  var cursor = offset + 4;
  if (cursor > buffer.length) return null;
  var intField = buffer.readInt32BE(offset);

  if (intField === 0) {
    return {
      value: {
        intField: intField,
      },
      size: cursor - offset,
    };
  }

  if (cursor + 6 > buffer.length) return null;
  var velocityX = buffer.readInt16BE(cursor);
  cursor += 2;
  var velocityY = buffer.readInt16BE(cursor);
  cursor += 2;
  var velocityZ = buffer.readInt16BE(cursor);
  cursor += 2;

  return {
    value: {
      intField: intField,
      velocityX: velocityX,
      velocityY: velocityY,
      velocityZ: velocityZ,
    },
    size: cursor - offset,
  };
}

function readMapChunkBulk (buffer, offset) {
  var cursor = offset + 7;
  if (cursor > buffer.length) return null;
  var chunkCount = buffer.readInt16BE(offset);
  var dataSize = buffer.readInt32BE(offset + 2);
  var skyLightSent = !!buffer.readInt8(offset + 6);

  var endCursor = cursor + dataSize + 12 * chunkCount;
  if (endCursor > buffer.length) return null;

  var compressedChunkDataEnd = cursor + dataSize;
  var compressedChunkData = buffer.slice(cursor, compressedChunkDataEnd);
  cursor = compressedChunkDataEnd;

  var meta = [];
  var i, chunkX, chunkZ, primaryBitMap, addBitMap;
  for (i = 0; i < chunkCount; ++i) {
    chunkX = buffer.readInt32BE(cursor);
    cursor += 4;
    chunkZ = buffer.readInt32BE(cursor);
    cursor += 4;
    primaryBitMap = buffer.readUInt16BE(cursor);
    cursor += 2;
    addBitMap = buffer.readUInt16BE(cursor);
    cursor += 2;

    meta.push({
      chunkX: chunkX,
      chunkZ: chunkZ,
      primaryBitMap: primaryBitMap,
      addBitMap: addBitMap,
    });
  }

  return {
    value: {
      skyLightSent: skyLightSent,
      compressedChunkData: compressedChunkData,
      meta: meta,
    },
    size: endCursor - offset,
  };
}

function readString (buffer, offset) {
  var results = readShort(buffer, offset);
  if (! results) return null;
  
  var strBegin = offset + results.size;
  var strLen = results.value;
  var strEnd = strBegin + strLen * 2;
  if (strEnd > buffer.length) return null;
  var str = fromUcs2.convert(buffer.slice(strBegin, strEnd)).toString('utf8');

  return {
    value: str,
    size: strEnd - offset,
  };
}

function readByteArray (buffer, offset) {
  var results = readShort(buffer, offset);
  if (! results) return null;

  var bytesBegin = offset + results.size;
  var bytesSize = results.value;
  var bytesEnd = bytesBegin + bytesSize;
  if (bytesEnd > buffer.length) return null;
  var bytes = buffer.slice(bytesBegin, bytesEnd);

  return {
    value: bytes,
    size: bytesEnd - offset,
  };
}

function readBigByteArray(buffer, offset) {
  var results = readInt(buffer, offset);
  if (! results) return null;

  var bytesBegin = offset + results.size;
  var bytesSize = results.value;
  var bytesEnd = bytesBegin + bytesSize;
  if (bytesEnd > buffer.length) return null;
  var bytes = buffer.slice(bytesBegin, bytesEnd);

  return {
    value: bytes,
    size: bytesEnd - offset,
  };
}

function readSlotArray (buffer, offset) {
  var results = readShort(buffer, offset);
  if (! results) return null;
  var count = results.value;
  var cursor = offset + results.size;

  var slotArray = [];
  for (var i = 0; i < count; ++i) {
    results = readSlot(buffer, cursor);
    if (! results) return null;
    slotArray.push(results.value);
    cursor += results.size;
  }

  return {
    value: slotArray,
    size: cursor - offset,
  };
}

function readShort(buffer, offset) {
  if (offset + 2 > buffer.length) return null;
  var value = buffer.readInt16BE(offset);
  return {
    value: value,
    size: 2,
  };
}

function readUShort(buffer, offset) {
  if (offset + 2 > buffer.length) return null;
  var value = buffer.readUInt16BE(offset);
  return {
    value: value,
    size: 2,
  };
}

function readInt(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  var value = buffer.readInt32BE(offset);
  return {
    value: value,
    size: 4,
  };
}

function readFloat(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  var value = buffer.readFloatBE(offset);
  return {
    value: value,
    size: 4,
  };
}

function readDouble(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  var value = buffer.readDoubleBE(offset);
  return {
    value: value,
    size: 8,
  };
}

function readLong(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  var value = buffer.readInt64BE(offset);
  return {
    value: value,
    size: 8,
  };
}

function readByte(buffer, offset) {
  if (offset + 1 > buffer.length) return null;
  var value = buffer.readInt8(offset);
  return {
    value: value,
    size: 1,
  };
}

function readUByte(buffer, offset) {
  if (offset + 1 > buffer.length) return null;
  var value = buffer.readUInt8(offset);
  return {
    value: value,
    size: 1,
  };
}

function readBool(buffer, offset) {
  if (offset + 1 > buffer.length) return null;
  var value = buffer.readInt8(offset);
  return {
    value: !!value,
    size: 1,
  };
}

function readSlot(buffer, offset) {
  var results = readShort(buffer, offset);
  if (! results) return null;
  var blockId = results.value;
  var cursor = offset + results.size;

  if (blockId === -1) {
    return {
      value: { id: blockId },
      size: cursor - offset,
    };
  }

  results = readByte(buffer, cursor);
  if (! results) return null;
  var itemCount = results.value;
  cursor += results.size;

  results = readShort(buffer, cursor);
  if (! results) return null;
  var itemDamage = results.value;
  cursor += results.size;

  results = readShort(buffer, cursor);
  if (! results) return null;
  var nbtDataSize = results.value;
  cursor += results.size;

  if (nbtDataSize === -1) nbtDataSize = 0;
  var nbtDataEnd = cursor + nbtDataSize;
  var nbtData = buffer.slice(cursor, nbtDataEnd);

  return {
    value: {
      blockId: blockId,
      itemCount: itemCount,
      itemDamage: itemDamage,
      nbtData: nbtData,
    },
    size: nbtDataEnd - offset,
  };
}

function StringWriter(value) {
  this.value = value;
  this.encoded = toUcs2.convert(value);
  this.size = 2 + this.encoded.length;
}

StringWriter.prototype.write = function(buffer, offset) {
  buffer.writeInt16BE(this.value.length, offset);
  this.encoded.copy(buffer, offset + 2);
};

function ByteArrayWriter(value) {
  assert.ok(Buffer.isBuffer(value), "non buffer passed to ByteArrayWriter");
  this.value = value;
  this.size = 2 + value.length;
}

ByteArrayWriter.prototype.write = function(buffer, offset) {
  buffer.writeInt16BE(this.value.length, offset);
  this.value.copy(buffer, offset + 2);
};

function ByteWriter(value) {
  this.value = value;
  this.size = 1;
}

ByteWriter.prototype.write = function(buffer, offset) {
  buffer.writeInt8(this.value, offset);
}

function UByteWriter(value) {
  this.value = value;
  this.size = 1;
}

UByteWriter.prototype.write = function(buffer, offset) {
  buffer.writeUInt8(this.value, offset);
};

function IntWriter(value) {
  this.value = value;
  this.size = 4;
}

IntWriter.prototype.write = function(buffer, offset) {
  buffer.writeInt32BE(this.value, offset);
}

function createPacketBuffer(packetId, params) {
  var size = 1;
  var fields = [ new UByteWriter(packetId) ];
  var packet = packets[packetId];
  packet.forEach(function(fieldInfo) {
    var value = params[fieldInfo.name];
    var Writer = writers[fieldInfo.type];
    assert.ok(Writer, "missing writer for data type: " + fieldInfo.type);
    var field = new Writer(value);
    size += field.size;
    fields.push(field);
  });
  var buffer = new Buffer(size);
  var cursor = 0;
  fields.forEach(function(field) {
    field.write(buffer, cursor);
    cursor += field.size;
  });
  return buffer;
}

function parsePacket(buffer) {
  if (buffer.length < 1) return null;
  var packetId = buffer.readUInt8(0);
  console.log("parsing packet " + packetId);
  var size = 1;
  var results = { id: packetId };
  var packetInfo = packets[packetId];
  assert.ok(packetInfo, "Unrecognized packetId: " + packetId);
  var i, fieldInfo, read, readResults;
  for (i = 0; i < packetInfo.length; ++i) {
    fieldInfo = packetInfo[i];
    read = readers[fieldInfo.type];
    assert.ok(read, "missing reader for data type: " + fieldInfo.type);
    readResults = read(buffer, size);
    if (readResults) {
      results[fieldInfo.name] = readResults.value;
      size += readResults.size;
    } else {
      // buffer needs to be more full
      return null;
    }
  }
  return {
    size: size,
    results: results,
  };
}

// packet ids
Parser.KEEP_ALIVE = 0x00;
Parser.LOGIN_REQUEST = 0x01;
Parser.HANDSHAKE = 0x02;
Parser.CHAT_MESSAGE = 0x03;
Parser.TIME_UPDATE = 0x04;
Parser.ENTITY_EQUIPMENT = 0x05;
Parser.SPAWN_POSITION = 0x06;
Parser.USE_ENTITY = 0x07;
Parser.UPDATE_HEALTH = 0x08;
Parser.RESPAWN = 0x09;
Parser.PLAYER = 0x0A;
Parser.PLAYER_POSITION = 0x0B;
Parser.PLAYER_LOOK = 0x0C;
Parser.PLAYER_POSITION_AND_LOOK = 0x0D;
Parser.PLAYER_DIGGING = 0x0E;
Parser.PLAYER_BLOCK_PLACEMENT = 0x0F;
Parser.HELD_ITEM_CHANGE = 0x10;
Parser.USE_BED = 0x11;
Parser.ANIMATION = 0x12;
Parser.ENTITY_ACTION = 0x13;
Parser.SPAWN_NAMED_ENTITY = 0x14;
Parser.COLLECT_ITEM = 0x16;
Parser.SPAWN_OBJECT_VEHICLE = 0x17;
Parser.SPAWN_MOB = 0x18;
Parser.SPAWN_PAINTING = 0x19;
Parser.SPAWN_EXPERIENCE_ORB = 0x1A;
Parser.ENTITY_VELOCITY = 0x1C;
Parser.DESTROY_ENTITY = 0x1D;
Parser.ENTITY = 0x1E;
Parser.ENTITY_RELATIVE_MOVE = 0x1F;
Parser.ENTITY_LOOK = 0x20;
Parser.ENTITY_LOOK_AND_RELATIVE_MOVE = 0x21;
Parser.ENTITY_TELEPORT = 0x22;
Parser.ENTITY_HEAD_LOOK = 0x23;
Parser.ENTITY_STATUS = 0x26;
Parser.ATTACH_ENTITY = 0x27;
Parser.ENTITY_METADATA = 0x28;
Parser.ENTITY_EFFECT = 0x29;
Parser.REMOVE_ENTITY_EFFECT = 0x2A;
Parser.SET_EXPERIENCE = 0x2B;
Parser.CHUNK_DATA = 0x33;
Parser.MULTI_BLOCK_CHANGE = 0x34;
Parser.BLOCK_CHANGE = 0x35;
Parser.BLOCK_ACTION = 0x36;
Parser.BLOCK_BREAK_ANIMATION = 0x37;
Parser.MAP_CHUNK_BULK = 0x38;
Parser.EXPLOSION = 0x3C;
Parser.SOUND_OR_PARTICLE_EFFECT = 0x3D;
Parser.NAMED_SOUND_EFFECT = 0x3E;
Parser.CHANGE_GAME_STATE = 0x46;
Parser.SPAWN_GLOBAL_ENTITY = 0x47;
Parser.OPEN_WINDOW = 0x64;
Parser.CLOSE_WINDOW = 0x65;
Parser.CLICK_WINDOW = 0x66;
Parser.SET_SLOT = 0x67;
Parser.SET_WINDOW_ITEMS = 0x68;
Parser.UPDATE_WINDOW_PROPERTY = 0x69;
Parser.CONFIRM_TRANSACTION = 0x6A;
Parser.CREATIVE_INVENTORY_ACTION = 0x6B;
Parser.ENCHANT_ITEM = 0x6C;
Parser.UPDATE_SIGN = 0x82;
Parser.ITEM_DATA = 0x83;
Parser.UPDATE_TILE_ENTITY = 0x84;
Parser.INCREMENT_STATISTIC = 0xC8;
Parser.PLAYER_LIST_ITEM = 0xC9;
Parser.PLAYER_ABILITIES = 0xCA;
Parser.TAB_COMPLETE = 0xCB;
Parser.CLIENT_SETTINGS = 0xCC;
Parser.CLIENT_STATUSES = 0xCD;
Parser.PLUGIN_MESSAGE = 0xFA;
Parser.ENCRYPTION_KEY_RESPONSE = 0xFC;
Parser.ENCRYPTION_KEY_REQUEST = 0xFD;
Parser.SERVER_LIST_PING = 0xFE;
Parser.DISCONNECT_KICK = 0xFF;
