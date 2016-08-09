from neo4jrestclient import client
from neo4jrestclient.client import GraphDatabase

q = 'MATCH (u1)-[r]->(u2) RETURN u1,r,u2'

db = GraphDatabase("http://localhost:7474", username="neo4j", password="admin")
results = db.query(q, returns=(client.Node, client.Relationship, client.Node))

for r in results:
    ports = []
#    print r[1].properties
#    if r[1].properties:
#        for p in r[1]['data']['ports']:
#            ports.append(p)
    print("(%s)-[%s:%s]->(%s)" % (r[0]["name"], r[1].type, r[1].properties, r[2]["name"]))
