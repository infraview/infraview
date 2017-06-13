var mongoose = require('mongoose');
var ObjectId = mongoose.Schema.Types.ObjectId;

module.exports = mongoose.model('Node', new mongoose.Schema({
  'id': {
    type: String,
    required: true
  },
  'type': {
    type: String,
    required: true
  },
  'name': {
    type: String
  },
  'service': {
    type: String
  },
  'service_id': {
    type: ObjectId
  },
  'ip': {
    type: String
  },
  'private_ip': {
    type: String
  },
  'region': {
    type: String
  },
  'zone': {
    type: String
  },
  'connects_to': {
    type: []
  },
  'connections': {
    type: []
  },
  'connectionDetails': {
    type: String
  },
  'connectionLastRefresh': {
    type: Date
  }
}));
