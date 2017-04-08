"""
# TIER 0
Display instances:
MATCH (s:t0)-[r]->(d) RETURN s,r,d

Display instances filtered by service (eg: mysql):
MATCH (s:t0)-[r]->(d) WHERE s.service='mysql' RETURN s,r,d


# TIER 1
Display groups:
MATCH (s:t1)-[r]->(d) RETURN s,r,d

Display groups that connect to 'mysql':
MATCH (s:t1)-[r]->(d:t1) WHERE d.service='mysql' RETURN s,r,d

Display groups or external services that connect to 'mysql':
MATCH (s)-[r]->(d:t1) WHERE d.service='mysql' RETURN s,r,d

Display groups that 'mysql' connects to:
MATCH (s:t1)-[r]->(d:t1) WHERE s.service='mysql' RETURN s,r,d

Display groups or external services that 'mysql' connects to:
MATCH (s:t1)-[r]->(d) WHERE s.service='mysql' RETURN s,r,d

Display groups that connect to 'mysql' and that 'mysql' connects to:
MATCH (s:t1)-[r]->(d:t1) WHERE s.service='mysql' OR d.service='mysql' RETURN s,r,d

Display groups or external services that connect to 'mysql' and that 'mysql' connects to:
MATCH (s)-[r]->(d) WHERE s.service='mysql' OR d.service='mysql' RETURN s,r,d

# TIER 2
Display projects:
MATCH (u1:t2)-[r]->(u2) RETURN u1,r,u2
"""

import copy
import re
import socket
import sys

from fabric import tasks
from fabric.api import hide, env, run, parallel
from fabric.context_managers import settings
from neo4jrestclient import client
from neo4jrestclient.client import GraphDatabase

# TODO: add argparse
DEFAULT_HOSTS_FILE = './hosts'
DEFAULT_TIER_LEVELS = '(.*)\.(.*)\.east\.netview\.tech'

hosts = {}


#############
db = GraphDatabase("http://localhost:7474", username="neo4j", password="admin")

# Create some nodes with labels
t0 = db.labels.create("t0")
t1 = db.labels.create("t1")
t2 = db.labels.create("t2")

env.user = 'ubuntu'
env.connection_attempts = 3
env.warn_only = True
env.hosts = []


def create_node(name, host=None, label=None, service=None, member=None):
    """
        Checks if node exists and returns it while also adding a label to it,
        or creates it, if missing.
    """
    q = 'MATCH (u1) WHERE u1.name="%s" RETURN u1' % name
    node = db.query(q, returns=client.Node)
    if not node:
        print 'Created node ' + name
        node = db.nodes.create(name=name)
    else:
        node = db.nodes.get(node[0][0].id)

    if host:
        node.set('host', host)
    if service:
        node.set('service', service)

    # Add node label, if provided
    if label:
        indices = []
        if label.all():
            for n in label.all():
                indices.append(n.id)
            if node.id not in indices:
                label.add(node)
        else:
            label.add(node)

    # Add host to members attribute for t1 nodes
    if label and 't1' in str(label):
        try:
            members = node.get('members')
        except Exception as ex:
            all_members = []
            for host in hosts:
                if hosts[member]['group'] == hosts[host]['group']:
                    all_members.append(host)
            node.set('members', all_members)

    return node


def create_rel(src, dst, port):
    """
        Checks if relationship exists and creates it if missing or adds ports
        to its properties, if it already exists.
    """

    try:
        q = 'MATCH (s)-[r]->(d) WHERE s.name="%s" AND d.name="%s" RETURN r' % (src.properties['name'], dst.properties['name'])
        rel = db.query(q, returns=client.Relationship)
    except Exception as ex:
        print '### %s %s - %s' % (src.properties['name'], dst.properties['name'], port)
    if not rel:
        print 'Created link ' + src.properties['name'] + ' - ' + dst.properties['name']
        src.relationships.create('sends', dst, ports=[port])
    else:
        if port not in rel[0][0].properties['ports']:
            ports = rel[0][0].properties['ports']
            ports.append(port)
            rel[0][0].set('ports', ports)


#@parallel(pool_size=3)
def analyze():
    # CMD: all=$(netstat -Wtuln | tail -n +3 | awk '{print $4}' | tr -s ":" | cut -d ":" -f2 | tr "\n" "|" | sed "s/|/|:/g");
    # Build grep regex containing listening ports on host
    cmd = 'all=$(netstat -Wtuln | tail -n +3 | awk \'{print $4}\' | tr -s ":" | cut -d ":" -f2 | tr "\n" "|" | sed "s/|/|:/g")'
    # Filter all connections in netstat by listening ports
    cmd = cmd + ' && netstat -Wtuan | grep -iE "clos|sent|est|time" | while read line; do if $(echo $line | cut -d " " -f4 | grep -vE ".+(0.0.1:|:$(echo ${all:0:${#all}-2}))" &> /dev/null); then if $(echo $line | cut -d " " -f5 | grep -vE "localhost|0.0.0.0|:::" &> /dev/null); then echo $line; fi; fi; done | tail -n +3'

    print 'Running [%s/%s]' % (hosts.keys().index(env.host), len(hosts.keys()))

    try:
        with settings(host_string=hosts[env.host]['public_ip']):
            with hide('output'):
                res = run(cmd)
    except Exception as ex:
        print 'Failed for %s: %s' % (env.host, ex.message)
        return

    for line in res.split('\n'):
        line = line.split()
        if not line:
            continue

        protocol = line[0]
        src_ip = env.host
        dst_ip, dst_port = line[4].split(':')

        # Save copy of destination IP so we can reflect external services
        original_dst_ip = dst_ip

        # Index with hostname
        for host in hosts:
            if dst_ip in hosts[host]['line']:
                dst_ip = host

        # Create source and destination nodes if missing
        src = create_node(src_ip, host=env.host, label=t0, service=hosts[env.host]['service'])

        # Add destination group with attributes
        found = False
        for host in hosts:
            # Search for group of destination IP
            if dst_ip in hosts[host]['line']:
                dst = create_node(dst_ip, host=host, label=t0, service=hosts[host]['service'])
                found = True
                break
        if not found:
            dst = create_node(dst_ip)

        # Create relation and add port to it
        port = '%s %s' % (protocol.upper(), dst_port)
        create_rel(src, dst, port)

        # Look for destination in local hosts dict and check its group
        # in order to create different tier nodes
        found = False
        for host in hosts:
            # Search for group of destination IP
            if dst_ip in hosts[host]['line']:
                # Make sure it is not the same as source group
                if hosts[host]['group'] != hosts[env.host]['group']:
                    # Create source and destination nodes
                    gr_src = create_node(hosts[env.host]['group'], label=t1, service=hosts[env.host]['service'], member=env.host)
                    gr_dst = create_node(hosts[host]['group'], label=t1, service=hosts[host]['service'], member=host)

                    # Create relation and add port to it
                    port = '%s %s' % (protocol.upper(), dst_port)
                    create_rel(gr_src, gr_dst, port)

                    if hosts[host]['service'] != hosts[env.host]['service']:
                        # Create source and destination nodes
                        se_src = create_node(hosts[env.host]['service'], label=t2)
                        se_dst = create_node(hosts[host]['service'], label=t2)

                        # Create relation and add port to it
                        port = '%s %s' % (protocol.upper(), dst_port)
                        create_rel(se_src, se_dst, port)

                    found = True
                    break

        # Link connections with destinations outside the hosts dict
        if not found:
            gr_src = create_node(hosts[env.host]['group'],
                                 label=t1,
                                 service=hosts[env.host]['service'],
                                 member=env.host)
            gr_dst = create_node(original_dst_ip)

            # Create relation and add port to it
            port = '%s %s' % (protocol.upper(), dst_port)
            create_rel(gr_src, gr_dst, port)

    print 'Processed ' + env.host

def get_substr(prefix_list, prefix):
    """ Get common string of prefix and any element in list """

    saved_prefix = prefix
    saved_list = copy.deepcopy(prefix_list)

    # Remove prefix from list
    saved_list.remove(prefix)

    # Check if list is empty
    if not prefix_list:
        return prefix

    if not saved_list:
        print 'ERR. Tier regex problem.'
        sys.exit(1)

    done = False
    while not done:
        for item in saved_list:
            # when prefix ends with a digit, remove the digit
            if len(prefix) > 1 and prefix[-1].isdigit():
                prefix = prefix[0:-1]
            # when item starts with prefix
            if prefix == item[0:len(prefix)]:
                done = True
                break
        if not done:
            prefix = prefix[0:-1]

    # Remove tailing '-'
    if prefix and prefix[-1] == '-':
        prefix = prefix[0:-1]

    # If prefix is one letter use initial prefix
    if not prefix:
        return saved_prefix
    elif len(prefix) == 1:
        # Remove tailing digits from saved prefix
        while saved_prefix[-1].isdigit():
            saved_prefix = saved_prefix[0:-1]
        return saved_prefix
    else:
        return prefix


def main():
    # Parse script args
    hosts_file = DEFAULT_HOSTS_FILE
    if len(sys.argv) == 2:
        hosts_file = sys.argv[1]

    # Read hosts file
    with open(hosts_file, "r") as ins:
        for line in ins:
            # Remove \n if included
            if '\n' in line:
                line = line.split('\n')[0]
            # Save hosts in dict for easy manipulation
            if line and '#' not in line:
                hostname, private_ip, public_ip, service, role = line.split(',')
                hosts[hostname] = {}
                hosts[hostname]['line'] = line
                hosts[hostname]['public_ip'] = public_ip
                hosts[hostname]['private_ip'] = private_ip
                hosts[hostname]['service'] = service
                hosts[hostname]['role'] = role

    # Prepair list of hosts for fabric
    env.hosts = hosts.keys()

    if len(env.hosts) < 2:
        print 'ERR. You need at least 2 hosts.'
        sys.exit(1)

    # Prepair list of hostname prefixes
    hosts_prefix = []
    for host in hosts.keys():
        m = re.match(DEFAULT_TIER_LEVELS, host)

        # Match a different regex than default
        if not m:
            m = re.match('(.*)\.(.*)\.west\.netview\.tech', host)

        prefix = m.group(1)
        hosts_prefix.append(prefix)
        hosts[host]['hostname'] = prefix

    # Add host group
    for prefix in hosts_prefix:
        group = get_substr(hosts_prefix, prefix)
        for host in hosts:
            if hosts[host]['hostname'] == prefix:
                # Append service name to group so they are unique
                hosts[host]['group'] = '%s-%s' % (group, hosts[host]['service'])

    # Run script
    # TODO: run in parallel
    tasks.execute(analyze)


if __name__ == '__main__':
    main()
