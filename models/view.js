var mongoose = require('mongoose');
var ObjectId = mongoose.Schema.Types.ObjectId;

module.exports = mongoose.model('View', new mongoose.Schema({
  'creationTime': {
    type: Date,
    default: Date.now(),
    required: true
  },
  'lastSaveTime': {
    type: Date,
    required: true
  },
  'name': {
    type: String,
    required: true
  },
  'body': {
    type: String,
    required: true
  }
}));
