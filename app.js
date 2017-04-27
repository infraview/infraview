var aws = require('aws-sdk');
var express = require('express');
var fs = require('fs');
var mongoose = require('mongoose');
var request = require('request');

var app = express();
var log = require('./logging')();


mongoose.Promise = require('bluebird');
mongoose.connect('mongodb://localhost/infraview');

var Node = require('./models/node');
var Conn = require('./models/connection');

// Read config
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

aws.config.update({
  accessKeyId: config.aws_key,
  secretAccessKey: config.aws_secret,
  region: 'us-east-1'
});


var ec2 = new aws.EC2();
ec2.describeInstances(function (err, data) {
  if (err) {
    log.error(err, err.stack);
  } else {
    var nodes = [];
    data.Reservations.forEach(function(res) {
      res.Instances.forEach(function(ins) {

        if (ins.State.Name == 'running') {
          var InstanceName = null;
          var ServiceName = null;
          ins.Tags.forEach(function(tag) {
            if (tag.Key === 'Name') {
              InstanceName = tag.Value;
            }
            if (tag.Key === 'Service') {
              ServiceName = tag.Value;
            }
          });

          var AvailabilityZone = ins.Placement.AvailabilityZone;

          // Create or update service node
          Node.findOneAndUpdate({id: ServiceName}, {
            id: ServiceName,
            name: ServiceName,
            type: 'service',
          }, {upsert: true, new: true}, function (err, service) {
            if (err) {
              log.error('[ERR] Failed to add service node: ' + err)
            } else {
              // Create or update instance node
              Node.update({id: ins.InstanceId}, {
                id: ins.InstanceId,
                name: InstanceName || ins.InstanceId,
                type: 'instance',
                service: ServiceName,
                service_id: service._id,
                ip: ins.PublicIpAddress,
                private_ip: ins.PrivateIpAddress,
                region: AvailabilityZone.substring(0, AvailabilityZone.length-1),
                zone: AvailabilityZone
              }, {upsert: true}).exec(function (err) {
                if (err) {
                  log.error('[ERR] Failed to add instance node: ' + err)
                }
              });

            }
          });
        }
      });
    });
  }
});


app.get('/', function (req, res) {
  res.redirect('/nodes');
});

app.get('/nodes', function (req, res) {
  Node.find().exec(function (err, nodes) {
    res.send(nodes);
  });
});

app.get('/refresh', function (req, res) {
  Node.find({type: 'instance'}).exec(function (err, nodes) {
    nodes.forEach(function (node) {

      request('http://' + node.ip + ':7777', function (err, response, body) {
        if (err) {
          // Save connection error message
          Node.update({id: node.id}, {
            connectionDetails: err
          }).exec(function (err) {
            if (err) {
              log.error('[ERR] Failed to update node connection details: ' + err);
            }
          });

        } else {
          //log.error('error:', error); // Print the error if one occurred
          //log.error('statusCode:', response && response.statusCode); // Print the response status code if a response was received
          //log.error('body:', body); // Print the HTML for the Google homepage.

          var conns = [];
          // Build list of new connections for node
          JSON.parse(body).forEach(function(conn) {
            conns.push({
              'node': node._id,
              'service': node.service_id,
              'timestamp': conn.t,
              'source': conn.s,
              'destination': conn.d
            });
          });
          // Save all new connections at once
          Conn.insertMany(conns, function(err, docs) {
            if (err) {
              log.error('[ERR] Failed to save connections: ' + err);
            } else {
              // Save connection IDs
              var conn_ids = [];
              docs.forEach(function(doc) {
                conn_ids.push(doc._id);
              });
              // Attach connection IDs to instance and service nodes
              Node.update({$or: [{_id: node._id}, {name: node.service}]}, {
                connectionDetails: 'OK',
                connections: conn_ids
              }, {"multi": true}).exec(function (err, doc) {
                if (err) {
                  log.error('[ERR] Failed to save node connection: ' + err);
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

app.get('/bind', function (req, res) {
  Conn.find().exec(function (err, conns) {
    if (err) {
      log.error('[ERR] Failed to get connections: ' + err);
    } else {
      conns.forEach(function (conn) {
        Node.findOne({'private_ip': conn.destination.split(':')[0]}).exec(function (err, node) {
          if (err) {
            log.error('[ERR] Failed to get destination node: ' + err);
          }
          if (node) {
            // Save inter-instance connection
            Node.update({'_id': conn.node}, {$addToSet: {'connects_to': node._id}}).exec(function (err) {
              if (err) {
                log.error('[ERR] Failed to push connected instance node: ' + err);
              }
            });
            // Save inter-service connection
            Node.update({'_id': conn.service}, {$addToSet: {'connects_to': node.service_id}}).exec(function (err) {
              if (err) {
                log.error('[ERR] Failed to push connected service node: ' + err);
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
  res.setHeader('Access-Control-Allow-Origin', '*');

  var viz = {
    serverUpdateTime: Date.now(),
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
      metadata: {},
      updated: Date.now()
    }, {
      displayName: 'us-east-1',
      name: 'us-east-1',
      connections: [],
      renderer: 'region',
      nodes: [],
      class: 'normal',
      metadata: {},
      updated: Date.now()
    }],
    renderer: 'global',
    name: 'edge'
  }

  // Append service nodes
  Node.aggregate([{$match: {type: 'service'}}, {
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
      log.error('[ERR] Failed to get service aggegation: ' + err);
    } else {
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
          metadata: { inbound: [], outbound: [] },
          updated: Date.now()
        });
        // Add us-east-1 connections
        node.graph.forEach(function (conn) {
          viz.nodes[1].connections.push({
            target: conn.name,
            metrics: { normal: 50000 },
            source: node.name,
            notices: [],
            class: 'normal',
            metadata: { streaming: 1 }
          });
        });
      });

      updateInstances(viz);
    }
  });

  function updateInstances (viz) {
    // Append instance nodes
    Node.aggregate([{$match: {type: 'instance'}}, {
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
        log.error('[ERR] Failed to get service aggegation: ' + err);
      } else {
        graph.forEach(function (node) {
          // Add us-east-1 nodes
          viz.nodes[1].nodes.forEach(function(service) {
            if (service.name == node.service) {
              service.nodes.push({
                displayName: node.name,
                name: node.name,
                connections: [],
                renderer: 'region',
                props: {},
                maxVolume: 96035.538,
                nodes: [],
                class: 'normal',
                metadata: { inbound: [], outbound: [] },
                updated: Date.now()
              });
            }
          });
          // Add us-east-1 connections
          viz.nodes[1].nodes.forEach(function(service) {
            if (service.name == node.service) {
              node.graph.forEach(function (conn) {
                service.connections.push({
                  target: conn.name,
                  metrics: { normal: 50000 },
                  source: node.name,
                  notices: [],
                  class: 'normal',
                  metadata: { streaming: 1 }
                });
              });
            }
          });
        });

        res.send(viz);
      }
    });
  }

});

app.listen(3000, function () {
  log.info('Infraview backend listening on port 3000: http://localhost:3000');
});
