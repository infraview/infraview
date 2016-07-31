from fabric import tasks
from fabric.api import env, run
from neo4jrestclient import client
from neo4jrestclient.client import GraphDatabase
import socket
 
db = GraphDatabase("http://localhost:7474", username="neo4j", password="admin")
 
# Create some nodes with labels
#user = db.labels.create("User")
#c1 = db.nodes.create(name="192.168.0.1")
#user.add(c1)
#c1.relationships.create("sends", srv, _80="TCP")


env.hosts = ['rosedu.org', 'projects.rosedu.org']
env.user = 'root'

def analyze():
    res = run('netstat -ntu | tail -n +3 | tr -s " "')
    for line in res.split('\n'):
        line = line.split()
        protocol = line[0]
        src_ip, src_port = line[3].split(':')
        dst_ip, dst_port = line[4].split(':')

	q = 'MATCH (u1) WHERE u1.name="%s" RETURN u1' % src_ip
        src = db.query(q, returns=client.Node)
        if not src:
            src = db.nodes.create(name=src_ip)
        else:
            src = db.nodes.get(src[0][0].id)

	q = 'MATCH (u1) WHERE u1.name="%s" RETURN u1' % dst_ip
        dst = db.query(q, returns=client.Node)
        if not dst:
            dst = db.nodes.create(name=dst_ip)
        else:
            dst = db.nodes.get(dst[0][0].id)

	# Use node labels
        #host = socket.gethostbyaddr(src_ip)
	#host = db.labels.create(host[0])
        #host.add(src)

	q = 'MATCH (s)-[r]->(d) WHERE s.name="%s" AND d.name="%s" AND r.protocol="%s" AND r.source="%s" AND r.destination="%s" RETURN r' % (src_ip, dst_ip, protocol, src_port, dst_port)
        rel = db.query(q, returns=client.Relationship)
        if not rel:
            name = '%s %s' % (protocol.upper(), dst_port)
            src.relationships.create(name, dst, protocol=protocol, source=src_port, destination=dst_port)

tasks.execute(analyze)
