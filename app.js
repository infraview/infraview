var aws = require('aws-sdk');
var express = require('express');
var fs = require('fs');
var mongoose = require('mongoose');
var request = require('request');

var app = express();


mongoose.Promise = require('bluebird');
mongoose.connect('mongodb://localhost/infraview');


var Schema = mongoose.Schema;
var Node = mongoose.model('InfraNode', new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  ip: { type: String },
  private_ip: { type: String },
  connects_to: { type: [] },
  connections: { type: [] },
  connectionDetails: { type: String }
}));
var Conn = mongoose.model('InfraConn', new Schema({
  node: { type: Schema.ObjectId, required: true },
  timestamp: { type: String, required: true },
  source: { type: String, required: true },
  destination: { type: String, required: true }
}));

// Read config
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

aws.config.update({
  accessKeyId: config.aws_key,
  secretAccessKey: config.aws_secret,
  region: 'us-east-1'
});


// function sendEmail() {
//   email.send(to, headers, body);
//   setTimeout(sendEmail, 10*1000);
// }
// setTimeout(sendEmail, 10*1000);
var ec2 = new aws.EC2();
ec2.describeInstances(function (err, data) {
  if (err) {
    console.log(err, err.stack);
  } else {
    var nodes = [];
    data.Reservations.forEach(function(res) {
      res.Instances.forEach(function(ins) {
        if (ins.State.Name == 'running') {
          var InstanceName = null;
          ins.Tags.forEach(function(tag) {
            if (tag.Key === 'Name') {
              InstanceName = tag.Value;
            }
          });

          Node.update({id: ins.InstanceId}, {
            id: ins.InstanceId,
            name: InstanceName || ins.InstanceId,
            ip: ins.PublicIpAddress,
            private_ip: ins.PrivateIpAddress
          }, {upsert: true}).exec(function (err) {
            if (err) {
              console.log('[ERR] Failed to add node: ' + err)
            }
          });
        }
      });
    });
  }
});


app.get('/', function (req, res) {
  Node.find().exec(function (err, nodes) {
    res.send(nodes);
  });
});

app.get('/refresh', function (req, res) {
  Node.find().exec(function (err, nodes) {
    nodes.forEach(function (node) {

      request('http://' + node.ip + ':7777', function (err, response, body) {
        if (err) {
          // Save connection error message
          Node.update({id: node.id}, {
            connectionDetails: err
          }).exec(function (err) {
            if (err) {
              console.log('[ERR] Failed to update node connection details: ' + err);
            }
          });

        } else {
          //console.log('error:', error); // Print the error if one occurred
          //console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
          //console.log('body:', body); // Print the HTML for the Google homepage.

          var conns = [];
          // Build list of new connections for node
          JSON.parse(body).forEach(function(conn) {
            conns.push({
              'node': node._id,
              'timestamp': conn.t,
              'source': conn.s,
              'destination': conn.d
            });
          });
          // Save all new connections at once
          Conn.insertMany(conns, function(err, docs) {
            if (err) {
              console.log('[ERR] Failed to save connections: ' + err);
            } else {
              // Save connection IDs
              var conn_ids = [];
              docs.forEach(function(doc) {
                conn_ids.push(doc._id);
              });
              // Attach connection IDs to node
              Node.update({_id: node._id}, {
                connectionDetails: 'OK',
                connections: conn_ids
              }).exec(function (err) {
                if (err) {
                  console.log('[ERR] Failed to save node connection: ' + err);
                }
              });
            }
          });
        }
      });
    });
  });

  res.redirect('/');
});

app.get('/nodes', function (req, res) {
  Conn.find().exec(function (err, conns) {
    if (err) {
      console.log('[ERR] Failed to save node connection: ' + err);
    } else {
      conns.forEach(function (conn) {
        Node.findOne({'private_ip': conn.destination.split(':')[0]}).exec(function (err, node) {
          if (err) {
            console.log('[ERR] Failed to get destination node: ' + err);
          }
          if (node) {
            Node.update({'_id': conn.node}, {$addToSet: {'connects_to': node._id}}).exec(function (err) {
              if (err) {
                console.log('[ERR] Failed to push connected node: ' + err);
              }
            });
          }
        });
      });
    }
  });

  res.redirect('/');
});

app.get('/graph', function (req, res) {

  Node.aggregate([{$match: {}}, {
    $graphLookup: {
      from: 'infranodes', // Use the customers collection
      startWith: '$connects_to', // Start looking at the document's `friends` property
      connectFromField: 'connects_to', // A link in the graph is represented by the friends property...
      connectToField: '_id', // ... pointing to another customer's _id property
      maxDepth: 1, // Only recurse one level deep
      as: 'graph' // Store this in the `connections` property
    }
  }]).exec(function (err, graph) {
    if (err) {
      console.log('[ERR] Failed to get destination node: ' + err);
    }
    console.log(graph);

    var viz = {
      connections: [{
        target: 'us-east-1',
        metrics: { normal: 50000 },
        source: 'INTERNET',
        notices: [],
        class: 'normal'
      }],
      nodes: [{
        displayName: 'INTERNET',
        name: 'INTERNET',
        connections: [],
        renderer: 'region',
        nodes: [],
        class: 'normal',
        metadata: {}
      }, {
        displayName: 'us-east-1',
        name: 'us-east-1',
        connections: [],
        renderer: 'region',
        nodes: [],
        class: 'normal',
        metadata: {}
      }],
      renderer: 'global',
      name: 'edge'
    }

    graph.forEach(function (node) {
      // Add us-east-1 nodes
      viz.nodes[1].nodes.push({
        displayName: node.name,
        name: node.name,
        connections: [],
        renderer: 'region',
        props: {},
        maxVolume: 96035.538,
        nodes: [],
        class: 'normal',
        metadata: {}
      });
      // Add us-east-1 connections
      node.graph.forEach(function (conn) {
        viz.nodes[1].connections.push({
          target: conn.name,
          metrics: {
            normal: 50000
          },
          source: node.name,
          notices: [],
          class: 'normal',
          metadata: {
            streaming: 1
          }
        });
      });
    });

    res.send(viz);
  });
});

app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});
