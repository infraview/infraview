var aws = require('aws-sdk');
var express = require('express');
var fs = require('fs');
var mongoose = require('mongoose');
var request = require('request');

var app = express();
var log = require('./logging')();


// Read config
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

mongoose.Promise = require('bluebird');
mongoose.connect('mongodb://' + config.mongo_url + '/infraview', {useMongoClient: true});

var Node = require('./models/node');
var Alert = require('./models/alert');
var Conn = require('./models/connection');
var View = require('./models/view');

aws.config.update({
  accessKeyId: config.aws_key,
  secretAccessKey: config.aws_secret,
  region: 'us-east-1'
});

// Refresh data function
function refreshResources() {
  if (config.nodes) {
    getStaticInstances();
  } else {
    var params = {
      Filters: [{
        Name: 'tag:Name',
        Values: [config.aws_instance_name_filter]
      }]
    };
    ec2.describeInstances(params, getInstances);
  }

  getConnections();
  bindConnections();
}
// Refresh data regularly
setInterval(refreshResources, config.refresh_resource_interval_ms);

// Refresh metric aggregations function
function refreshAggregations() {
   getAggregations();
}
// Refresh data regularly
setInterval(refreshAggregations, config.refresh_aggregations_interval_ms);

var ec2 = new aws.EC2();

function getConnections() {
  Node.find({type: 'instance'}).exec(function (err, nodes) {
    nodes.forEach(function (node) {

      var uri = 'http://' + node.ip + ':' + config.collect_port;
      request({uri: uri, timeout: config.collect_timeout}, function (err, response, body) {
        if (err) {
          // Save connection error message
          Node.update({id: node.id}, {
            connectionDetails: err
          }).exec(function (err) {
            if (err) {
              log.error('Failed to update node connection details: ' + err);
            }
          });
          // Alert on node down
          Alert.update({type: 'instance_down'}, {
            $addToSet: { 'affected': node._id }
          }).exec(function (err) {
            if (err) {
              log.error('Failed to add node down alert: ' + err);
            }
          });

        } else {
          var conns = [];
          body = JSON.parse(body);

          // Get timestamps in timeline
          var keys = Object.keys(body);

          // Remove last two most recent timestamp and only use the rest
          keys = keys.sort().slice(0, -config.scan_ignore_last);

          // Go over each timestamp
          keys.forEach(function(ts) {
            if (body[ts]) {
              // Get last timestamp saved in DB
              if (node.connectionLastRefresh) {
                var lastSavedTimestamp = parseInt(node.connectionLastRefresh.getTime() / 1000); // convert to seconds
              }
              // Create DB object and add to array
              if ((!node.connectionLastRefresh) || parseInt(ts) > lastSavedTimestamp) {
                // Build list of new connections for node
                body[ts].forEach(function(conn) {
                  conns.push({
                    'node': node._id,
                    'service': node.service_id,
                    'timestamp': conn.t,
                    'count': conn.c,
                    'source': conn.s.split(':')[0],
                    'source_port': conn.s.split(':')[1],
                    'destination': conn.d.split(':')[0],
                    'destination_port': conn.d.split(':')[1]
                  });
                });
              }
            }
          });

          // Save second most recent timestamp
          var lastTimestamp = keys.slice(-1);

          if (conns.length != 0) {
            log.debug('Added ' + conns.length + ' conns for ' + node.name);
          }

          // Save all new connections at once
          Conn.insertMany(conns, function(err, docs) {
            if (err) {
              log.error('Failed to save connections: ' + err);
            } else {
              // Save connection IDs
              var conn_ids = [];
              docs.forEach(function(doc) {
                conn_ids.push(doc._id);
              });
              // Attach connection IDs to instance and service nodes
              Node.update({$or: [{_id: node._id}, {name: node.service}]}, {
                connectionLastRefresh: new Date(lastTimestamp * 1000),
                connectionDetails: 'OK',
                connections: conn_ids
              }, {"multi": true}).exec(function (err, doc) {
                if (err) {
                  log.error('Failed to save node connection: ' + err);
                }
              });
            }
          });
          // Remove node down alert if any
          Alert.update({type: 'instance_down'}, {
            $pull: { 'affected': node._id }
          }).exec(function (err) {
            if (err) {
              log.error('Failed to remove node down alert: ' + err);
            }
          });
        }
      });
    });
  });
};

function getStaticInstances (err, data) {
  config.nodes.forEach(function(ins) {
    // Create or update service node
    Node.findOneAndUpdate({id: ins.service}, {
      id: ins.service,
      name: ins.service,
      type: 'service',
    }, {upsert: true, new: true}, function (err, service) {
      if (err) {
        log.error('Failed to add service node: ' + err)
      } else {
        // Create or update static instance node
        Node.update({id: ins.id}, {
          id: ins.id,
          name: ins.name,
          type: ins.type,
          service: ins.service,
          service_id: service._id,
          ip: ins.ip,
          private_ip: ins.private_ip,
          region: ins.region,
          zone: ins.zone
        }, {upsert: true}).exec(function (err) {
          if (err) {
            log.error('Failed to add static instance node: ' + err)
          }
        });
      }
    });
  })
}

function getInstances (err, data) {
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
              log.error('Failed to add service node: ' + err)
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
                  log.error('Failed to add instance node: ' + err)
                }
              });

            }
          });
        }
      });
    });
  }
};

function getAggregations() {
  // Get all connections from 60 seconds ago
  test_date = Date.now() - config.alert_aggregation_period_ms;
  Conn.aggregate([{$match: {timestamp: {$gt: test_date.toString()}}}, {
    $group: {
      _id: "$node",
      count: { $sum: "$count" }
    }
  }]).exec(function (err, graph) {
    // Gather alerting nodes
    var alerting_nodes = [];
    graph.forEach(function (alerted_host) {
      if (alerted_host.count > config.alert_connections_threshold) {
        alerting_nodes.push(alerted_host._id)
      }
    });

    // Alert number of collections
    Alert.update({type: 'connections'}, {
      $set: { 'affected': alerting_nodes },
    }, {upsert: true}).exec(function (err) {
      if (err) {
        log.error('Failed to add connections alert: ' + err);
      }
    });
  });
}


app.get('/', function (req, res) {
  res.redirect('/nodes');
});

app.get('/nodes', function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  Node.find().exec(function (err, nodes) {
    res.send(nodes);
  });
});


function getInboundOutboundConnections (IDs, callback) {
  var query = {$or: [{id: {$in: IDs}}, {service: {$in: IDs}}, {name: {$in: IDs}}]};
  Node.find(query).select({ 'private_ip': 1, 'ip': 1}).exec(function (err, nodes) {
    var all_ips = [];

    nodes.forEach(function(node) {
      all_ips.push(node.ip);
      all_ips.push(node.private_ip);
    });

    Conn.find({$or: [{source: {$in: all_ips}}, {destination: {$in: all_ips}}]}).exec(function (err, conns) {
      var response = { inbound: [], outbound: [] };

      conns.forEach(function(conn) {
        if (all_ips.indexOf(conn.source) > -1 && conn.destination_port < 32768) {
          // Add connection if it does not already exist
          var found = false;
          response.outbound.forEach(function (oconn) {
            if (oconn.destination == conn.destination && oconn.destination_port == conn.destination_port) {
              found = true;
            }
          });
          if (!found) {
            response.outbound.push(conn);
          }
        }
        if (all_ips.indexOf(conn.destination) > -1 && conn.source_port > 32768) {
          // Add connection if it does not already exist
          var found = false;
          response.inbound.forEach(function (iconn) {
            if (iconn.source == conn.source && iconn.destination_port == conn.destination_port) {
              found = true;
            }
          });
          if (!found) {
            response.inbound.push(conn);
          }
        }
      });

      return callback(response);
    });
  });
}


function bindConnections() {
  Conn.find().exec(function (err, conns) {
    if (err) {
      log.error('Failed to get connections: ' + err);
    } else {
      conns.forEach(function (conn) {
        Node.findOne({'private_ip': conn.destination}).exec(function (err, node) {
          if (err) {
            log.error('Failed to get destination node: ' + err);
          }
          if (node) {
            // Save inter-instance connection
            Node.update({'_id': conn.node}, {$addToSet: {'connects_to': node._id}}).exec(function (err) {
              if (err) {
                log.error('Failed to push connected instance node: ' + err);
              }
            });
            // Save inter-service connection
            Node.update({'_id': conn.service}, {$addToSet: {'connects_to': node.service_id}}).exec(function (err) {
              if (err) {
                log.error('Failed to push connected service node: ' + err);
              }
            });
          }
        });
      });
    }
  });
}

app.get('/connections', function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  getInboundOutboundConnections([req.query.node], sendResponse);

  function sendResponse(response) {
    res.send(response);
  }
});

app.get('/alerts', function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  Alert.find().populate('affected').exec(function (err, alerts) {
    res.send(alerts)
  });
});

app.get('/sg', function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  //var params = {GroupNames: []};
  ec2.describeSecurityGroups({}, function (err, data) {
    if (err) {
      log.error(err, err.stack);
    } else {
      res.send(data.SecurityGroups);
    }
  });
});

app.get('/inbound', function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  var instanceIDs = [];
  var params = { Filters: [{ Name: 'network-interface.group-id', Values: [req.query.sgID] }]};

  ec2.describeInstances(params, function(err, res) {
    res.Reservations.forEach(function(reservation) {
      // Gather instances
      reservation.Instances.forEach(function(instance) {
        instanceIDs.push(instance.InstanceId);
      })
    });
    // Get ports
    getInboundOutboundConnections(instanceIDs, sendResponse);
  });

  function sendResponse(response) {
    var inboundPorts = [];

    response.inbound.forEach(function (conn) {
      if (inboundPorts.indexOf(conn.destination_port) < 0) {
        inboundPorts.push(conn.destination_port);
      }
    });

    res.send(inboundPorts);
  }
});

app.get('/refresh', function (req, res) {
  getConnections();
  res.redirect('/');
});

app.get('/bind', function (req, res) {
  bindConnections();
  res.redirect('/');
});

app.get('/graph', function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  var _self = {};

  // Gather alerts
  Alert.aggregate([{ $unwind : "$affected" }]).exec(function (err, alerts) {
    if (err) {
      log.error('Failed to fetch alerts for graph: ' + err);
    }
    // Convert to dict for easy access
    _self.alerts = {};
    alerts.forEach(function (alert) {
      if (!(alert.affected in _self.alerts)) {
        _self.alerts[alert.affected] = [];
      }
      if (alert.type == 'connections') {
        _self.alerts[alert.affected].push({
          title: 'Max connections reached'
        });
      } else if (alert.type == 'instance_down') {
        _self.alerts[alert.affected].push({
          title: 'Node is DOWN'
        });
      } else if (alert.type == 'high_cpu_usage') {
        _self.alerts[alert.affected].push({
          title: 'High CPU Usage'
        });
      }
    });

    buildResponse();
  });

  function buildResponse() {
    var viz = {
      serverUpdateTime: Date.now(),
      connections: [{
        target: 'us-east-1',
        metrics: { normal: 1000 },
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
        from: 'nodes',                   // Use the nodes collection
        startWith: '$connects_to',       // Start looking at the document's `connects_to` property
        connectFromField: 'connects_to', // A link in the graph is represented by the connects_to property...
        connectToField: '_id',           // ... pointing to another customer's _id property
        maxDepth: 0,                     // Only recurse zero levels deep
        as: 'graph'                      // Store this in the `graph` property
      }
    }]).exec(function (err, graph) {
      if (err) {
        log.error('Failed to get service aggegation: ' + err);
      } else {
        graph.forEach(function (node) {
          // Add service nodes
          viz.nodes[1].nodes.push({
            displayName: node.name,
            name: node.name,
            connections: [],
            renderer: 'region',
            props: {},
            maxVolume: 3000,
            nodes: [],
            class: 'normal',
            metadata: { inbound: [], outbound: [] },
            updated: Date.now(),
            notices: []
          });
          // Add service connections
          node.graph.forEach(function (conn) {
            viz.nodes[1].connections.push({
              target: conn.name,
              metrics: { normal: 1000 },
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
  }

  function updateInstances (viz) {
    // Append instance nodes
    Node.aggregate([{$match: {type: 'instance'}}, {
      $graphLookup: {
        from: 'nodes',                   // Use the nodes collection
        startWith: '$connects_to',       // Start looking at the document's `connects_to` property
        connectFromField: 'connects_to', // A link in the graph is represented by the connects_to property...
        connectToField: '_id',           // ... pointing to another customer's _id property
        maxDepth: 0,                     // Only recurse zero levels deep
        as: 'graph'                      // Store this in the `graph` property
      }
    }]).exec(function (err, graph) {
      if (err) {
        log.error('Failed to get service aggegation: ' + err);
      } else {
        graph.forEach(function (node) {
          // Add instance nodes
          viz.nodes[1].nodes.forEach(function(service) {
            if (service.name == node.service) {
              service.nodes.push({
                displayName: node.name,
                name: node.name,
                connections: [],
                renderer: 'region',
                props: {},
                maxVolume: 3000,
                nodes: [],
                class: (_self.alerts[node._id] && _self.alerts[node._id].length ? 'danger' : 'normal'),
                metadata: { inbound: [], outbound: [] },
                updated: Date.now(),
                notices: _self.alerts[node._id]
              });

              // Add instance alert for corresponding service
              service.class = (_self.alerts[node._id] && _self.alerts[node._id].length ? 'danger' : 'normal')
              service.notices = _self.alerts[node._id]
            }
          });
          // Add instance connections
          viz.nodes[1].nodes.forEach(function(service) {
            if (service.name == node.service) {
              node.graph.forEach(function (conn) {
                service.connections.push({
                  target: conn.name,
                  metrics: { normal: 1000 },
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

app.post('/receive', function(req, res) {
  var _self = {};
  var bodyarr = [];

  req.on('data', function(chunk){
    bodyarr.push(chunk);
  })
  req.on('end', function(){
    _self.msg = JSON.parse(bodyarr.join(''));
    _self.alert = JSON.parse(_self.msg.Message);

    // Get alerted instance IDs
    var allIDs = [];
    _self.alert.Trigger.Dimensions.forEach(function(entry) {
      allIDs.push(entry.value);
    });

    // Determine NodeIDs from InstanceCD
    Node.find({id: {$in: allIDs}}).exec(gotInstanceIDs);
  });

  function gotInstanceIDs(err, nodes) {
    // Save NodeIDs separately
    var nodeIDs = [];
    nodes.forEach(function(node) {
      nodeIDs.push(node._id);
    });

    // Build update
    var update = {};
    if (_self.alert.NewStateValue === 'ALARM') {
      update = { $addToSet: { 'affected': { $each: nodeIDs }}};
    } else if (_self.alert.NewStateValue === 'OK'){
      update = { $pull: { 'affected': { $each: nodeIDs }}};
    } else {
      log.warn('Got unexpected message: ' + _self.alert);
    }


    // Add or remove CloudWatch ALert
    Alert.update({type: _self.alert.AlarmName}, update, {upsert: true}).exec(function (err, update) {
      if (err) {
        log.error('Failed to update CW alert: ' + err);
      }
    });
  }
});

app.get('/view', function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", '*');

  View.findOne({name: 'dash'}).exec(function (err, doc) {
    if (err) {
      log.error('Failed to save view: ' + err);
    }
    res.send(doc);
  });

});

app.post('/view', function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", '*');

  var _self = {};
  var bodyarr = [];

  req.on('data', function(chunk){
    bodyarr.push(chunk);
  })
  req.on('end', function(){
    _self.msg = JSON.parse(bodyarr.join(''));

    View.update({name: 'dash'}, {
      lastSaveTime: Date.now(),
      name: 'dash',
      body: JSON.stringify(_self.msg)
    }, {upsert: true, strict: false}).exec(function (err, doc) {
      if (err) {
        log.error('Failed to save view: ' + err);
      }
    });
  });

});


app.listen(2000, function () {
  log.info('Infraview backend listening on http://localhost:2000');
});
