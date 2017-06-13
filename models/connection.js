var mongoose = require('mongoose')
var ObjectId = mongoose.Schema.Types.ObjectId

module.exports = mongoose.model('Connection', new mongoose.Schema({
  'node': {
    type: ObjectId,
    required: true
  },
  'service': {
    type: ObjectId,
    required: true
  },
  'timestamp': {
    type: String,
    required: true
  },
  'count': {
    type: Number,
    required: true
  },
  'source': {
    type: String,
    required: true
  },
  'source_port': {
    type: String,
    required: true
  },
  'destination': {
    type: String,
    required: true
  },
  'destination_port': {
    type: String,
    required: true
  }
}));
