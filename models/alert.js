var mongoose = require('mongoose')
var ObjectId = mongoose.Schema.Types.ObjectId

module.exports = mongoose.model('Alert', new mongoose.Schema({
  'type': {
    type: String,
    required: true
  },
  'affected': {
    type: [{
      type: ObjectId,
      ref: 'Node'
    }],
    required: true
  },
  'threshold': {
    type: Number,
    required: false
  },
}));
