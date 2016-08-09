import copy
import re
import socket
import sys

from fabric import tasks
from fabric.api import env, run
from fabric.context_managers import settings
from neo4jrestclient import client
from neo4jrestclient.client import GraphDatabase

# TODO: add argparse
DEFAULT_HOSTS_FILE = './hosts'
DEFAULT_TIER_LEVELS = '(.*)\.(.*)\.east.netview.com'

hosts = {}


#############
db = GraphDatabase("http://localhost:7474", username="neo4j", password="admin")

# Create some nodes with labels
t0 = db.labels.create("t0")
t1 = db.labels.create("t1")

env.user = 'ubuntu'
env.hosts = []


def create_node(name, host=None, label=None):
    """
        Checks if node exists and returns it while also adding a label to it,
        or creates it, if missing.
    """
    q = 'MATCH (u1) WHERE u1.name="%s" RETURN u1' % name
    node = db.query(q, returns=client.Node)
    if not node:
        if host:
            node = db.nodes.create(name=name, host=host)
        else:
            node = db.nodes.create(name=name)
    else:
        node = db.nodes.get(node[0][0].id)

    # Add node label, if provided
    if label:
        indices = []
        for n in label.all():
            indices.append(n.id)
        if node.id not in indices:
            label.add(node)

    return node


def create_rel(src, dst, port):
    """
        Checks if relationship exists and creates it if missing or adds ports
        to its properties, if it already exists.
    """

    q = 'MATCH (s)-[r]->(d) WHERE s.name="%s" AND d.name="%s" RETURN r' % (src.properties['name'], dst.properties['name'])
    rel = db.query(q, returns=client.Relationship)
    if not rel:
        src.relationships.create('sends', dst, ports=[port])
    else:
        if port not in rel[0][0].properties['ports']:
            ports = rel[0][0].properties['ports']
            ports.append(port)
            rel[0][0].set('ports', ports)


def analyze():
    # Build grep regex containing listening ports on host
    cmd = 'all=$(netstat -Wtuln | tail -n +3 | awk \'{print $4}\' | tr -s ":" | cut -d ":" -f2 | tr "\n" "|" | sed "s/|/|:/g")'
    # Filter all connections in netstat by listening ports
    cmd = cmd + ' && netstat -Wtuan | grep -iE "clos|sent|est|time" | while read line; do if $(echo $line | cut -d " " -f4 | grep -vE ".+(0.0.1:|:$(echo ${all:0:${#all}-2}))" &> /dev/null); then if $(echo $line | cut -d " " -f5 | grep -vE "localhost|0.0.0.0|:::" &> /dev/null); then echo $line; fi; fi; done | tail -n +3'

    try:
        # Run cmd
        # TODO: do not print command output
        res = run(cmd)
    except Exception as ex:
        # Catch failed connections and retry them using public IP
        print 'Failed to connect to %s. Retrying with public IP.' % env.host
        with settings(host_string=hosts[env.host]['public_ip']):
            res = run(cmd)
    else:
        # Catch wrong user logins
        # TODO: add logging
        if 'Please login as' in res:
            print 'Login err:' + res
            sys.exit(1)

    for line in res.split('\n'):
        line = line.split()
        protocol = line[0]

        # src_ip = env.host
        src_ip = socket.gethostbyname(env.host)
        dst_ip, dst_port = line[4].split(':')

        # Create source and destination nodes if missing
        src = create_node(src_ip, host=env.host, label=t0)
        dst = create_node(dst_ip)

        # Create relation and add port to it
        port = '%s %s' % (protocol.upper(), dst_port)
        create_rel(src, dst, port)

        # Look for destination in local hosts dict and check its group
        # in order to create different tier nodes
        for host in hosts:
            # Search for group of destination IP
            if dst_ip in hosts[host]['line']:
                # Make sure it is not the same as source group
                if hosts[host]['group'] != hosts[env.host]['group']:
                    # Create source and destination nodes
                    # TODO: Add hosts in group as node property
                    gr_src = create_node(hosts[host]['group'], label=t1)
                    gr_dst = create_node(hosts[env.host]['group'], label=t1)

                    # Create relation and add port to it
                    port = '%s %s' % (protocol.upper(), dst_port)
                    create_rel(gr_src, gr_dst, port)
                    break

        #TODO: Connections with destinations outside the hosts dict should be
        # linked to a default node, named 'OTHER'


def get_substr(prefix_list, prefix):
    """ Get common string of prefix and any element in list """

    saved_prefix = prefix
    saved_list = copy.deepcopy(prefix_list)

    # Remove prefix from list
    saved_list.remove(prefix)

    # Check if list is empty
    if not prefix_list:
        return prefix

    done = False
    while not done:
        for item in saved_list:
            if prefix in item:
                done = True
                break
        if not done:
            prefix = prefix[0:-1]

    # Remove tailing '-'
    if prefix and prefix[-1] == '-':
        prefix = prefix[0:-1]

    if not prefix:
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
                hostname, private_ip, public_ip = line.split(',')
                hosts[hostname] = {}
                hosts[hostname]['line'] = line
                hosts[hostname]['public_ip'] = public_ip
                hosts[hostname]['private_ip'] = private_ip

    # Prepair host list for fabric
    env.hosts = hosts.keys()

    # Prepair list of hostname prefixes
    hosts_prefix = []
    for host in hosts.keys():
        m = re.match(DEFAULT_TIER_LEVELS, host)

        prefix = m.group(1)
        hosts_prefix.append(prefix)
        hosts[host]['hostname'] = prefix

    # Add host group
    for prefix in hosts_prefix:
        group = get_substr(hosts_prefix, prefix)
        for host in hosts:
            if hosts[host]['hostname'] == prefix:
                hosts[host]['group'] = group

    # print hosts
    # sys.exit(1)

    # Run script
    # TODO: run in parallel
    tasks.execute(analyze)


if __name__ == '__main__':
    main()
