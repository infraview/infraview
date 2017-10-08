var aws = require('aws-sdk');
var fs = require('fs');

// Read config
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

aws.config.update({
  accessKeyId: config.aws_key,
  secretAccessKey: config.aws_secret,
  region: 'us-east-1'
});

var ec2 = new aws.EC2();
var all_instances = [];

ec2.describeInstances( function(err, data) {
  if (err) {
    console.log(err, err.stack);
  } else {
    data.Reservations.forEach(function(reservation) {
      reservation.Instances.forEach(function(i) {
        var instance = {};

        instance.id = i.InstanceId;
        instance.type = 'instance';
        instance.private_ip = i.PrivateIpAddress;
        instance.zone = i.Placement.AvailabilityZone;
        instance.region = instance.zone.substring(0, instance.zone.length-1);

        if (i.PublicIpAddress) {
          instance.ip = i.PublicIpAddress;
        }

        i.Tags.forEach(function(tag) {
          if (tag.Key == 'Name') {
            instance.name = tag.Value;
          }

          if (tag.Key == 'Service') {
            instance.service = tag.Value;
            instance.service_id = '';
          }
        });

        all_instances.push(instance);
      })
    });
    console.log(JSON.stringify(all_instances, null, 2));
  }
});
