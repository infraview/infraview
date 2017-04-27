var mongoose = require('mongoose')
var ObjectId = mongoose.Schema.Types.ObjectId

module.exports = mongoose.model('InfraConn', new mongoose.Schema({
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
  'source': {
    type: String,
    required: true
  },
  'destination': {
    type: String,
    required: true
  }
}));
