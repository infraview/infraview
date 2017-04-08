import json
from neo4jrestclient import client
from neo4jrestclient.client import GraphDatabase

ALL_SERVICES = []


infra = {}
infra['renderer'] = 'global'
infra['name'] = 'edge'
infra['nodes'] = []
infra['connections'] = []
infra['serverUpdateTime'] = 1477691777441

# Add internet node
newnode = {}
newnode['renderer'] = 'region'
newnode['name'] = 'INTERNET'
newnode['displayName'] = 'INTERNET'
newnode['nodes'] = []
newnode['metadata'] = {}
newnode['class'] = 'normal'
newnode['connections'] = []

# Push newly discovered node
infra['nodes'].append(newnode)

# Add global node
newnode = {}
newnode['renderer'] = 'region'
newnode['name'] = 'EURO'
newnode['displayName'] = 'EURO'
newnode['nodes'] = []
newnode['metadata'] = {}
newnode['class'] = 'normal'
newnode['connections'] = []

# Push newly discovered node
infra['nodes'].append(newnode)

# Add connection
newconn = {}
newconn['source'] = 'INTERNET'
newconn['target'] = 'EURO'
newconn['metrics'] = {}
newconn['metrics']['normal'] = 50000
newconn['notices'] = []
newconn['class'] = 'normal'

# Push connection between regions
infra['connections'].append(newconn)


# Get all available services
q = 'MATCH (u) RETURN u'
db = GraphDatabase("http://localhost:7474", username="neo4j", password="admin")
results = db.query(q, returns=(client.Node, client.Relationship, client.Node))
for r in results:

    if r[0]["service"] not in ALL_SERVICES:
        ALL_SERVICES.append(r[0]["service"])


# Get tier2
q = 'MATCH (u1:t2)-[r]->(u2:t2) RETURN u1,r,u2'
db = GraphDatabase("http://localhost:7474", username="neo4j", password="admin")
results = db.query(q, returns=(client.Node, client.Relationship, client.Node))
for r in results:

    # Check if source node already in dict
    found = False
    for reg in infra['nodes']:
        if reg['displayName'] == 'EURO':
            for node in reg['nodes']:
                if node['displayName'] == r[0]["name"]:
                    found = True

    if not found:
        newnode = {}
        newnode['renderer'] = 'region'
        newnode['name'] = r[0]["name"]
        newnode['displayName'] = r[0]["name"]
        newnode['nodes'] = []
        newnode['metadata'] = {}
        newnode['metadata']['inbound'] = [('TCP 80', '192.168.0.1')]
        newnode['metadata']['outbound'] = [('TCP 80', '192.168.0.2'), ('TCP 80', '192.168.0.3')]
        newnode['class'] = 'normal'
        newnode['connections'] = []
        newnode['props'] = {}
        newnode['updated'] = 1477690448572
        newnode['maxVolume'] = 96035.538

        # Push newly discovered node
        for reg in infra['nodes']:
            if reg['displayName'] == 'EURO':
                reg['nodes'].append(newnode)
        print newnode


    # Check if destination node already in dict
    found = False
    for reg in infra['nodes']:
        if reg['displayName'] == 'EURO':
            for node in reg['nodes']:
                if node['displayName'] == r[2]["name"]:
                    found = True

    if not found:
        newnode = {}
        newnode['renderer'] = 'region'
        newnode['name'] = r[2]["name"]
        newnode['displayName'] = r[2]["name"]
        newnode['nodes'] = []
        newnode['metadata'] = {}
        newnode['metadata']['inbound'] = [['TCP 80', '192.168.0.1']]
        newnode['metadata']['outbound'] = [['TCP 80', '192.168.0.2'], ['TCP 80', '192.168.0.3']]
        newnode['class'] = 'normal'
        newnode['connections'] = []
        newnode['props'] = {}
        newnode['updated'] = 1477690448572
        newnode['maxVolume'] = 96035.538

        # Push newly discovered node
        for reg in infra['nodes']:
            if reg['displayName'] == 'EURO':
                reg['nodes'].append(newnode)
        print newnode


    # Check if connection already in dict
    found = False
    for reg in infra['nodes']:
        if reg['displayName'] == 'EURO':
            for conn in reg['connections']:
                if conn['source'] == r[0]["name"] and conn['target'] == r[2]["name"]:
                    found = True

    if not found:
        newconn = {}
        newconn['source'] = r[0]["name"]
        newconn['target'] = r[2]["name"]
        newconn['metrics'] = {}
        newconn['metrics']['normal'] = 50000
        newconn['class'] = 'normal'
        newconn['notices'] = []
        newconn['metadata'] = {}
        newconn['metadata']['streaming'] = 1

        # Push newly discovered connection
        for reg in infra['nodes']:
            if reg['displayName'] == 'EURO':
                reg['connections'].append(newconn)
        for reg in infra['nodes']:
            if reg['displayName'] == 'EURO':
                reg['connections'].append(newconn)
        print '(%s) -> (%s)' % (r[0]["name"], r[2]["name"])

    #print("(%s)-[%s:%s]->(%s)" % (r[0]["name"], r[1].type, r[1].properties, r[2]["name"]))


for service in ALL_SERVICES:
    # Get tier1
    q = 'MATCH (s:t1)-[r]->(d:t1) WHERE s.service="' + service + '" OR d.service="' + service + '" RETURN s,r,d'
    db = GraphDatabase("http://localhost:7474", username="neo4j", password="admin")
    results = db.query(q, returns=(client.Node, client.Relationship, client.Node))
    for r in results:

        # Check if source node already in dict
        found = False
        for reg in infra['nodes']:
            if reg['displayName'] == 'EURO':
                for node in reg['nodes']:
                    if node['displayName'] == service:
                        for i in node['nodes']:
                            if i['name'] == r[0]["name"]:
                                found = True

        if not found:
            newnode = {}
            newnode['renderer'] = 'focusedChild'
            newnode['name'] = r[0]["name"]
            newnode['clusters'] = []
            newnode['metadata'] = {}

            # Push newly discovered node
            for reg in infra['nodes']:
                if reg['displayName'] == 'EURO':
                    for node in reg['nodes']:
                        if node['displayName'] == service:
                            node['nodes'].append(newnode)

        # Check if target node already in dict
        found = False
        for reg in infra['nodes']:
            if reg['displayName'] == 'EURO':
                for node in reg['nodes']:
                    if node['displayName'] == service:
                        for i in node['nodes']:
                            if i['name'] == r[0]["name"]:
                                found = True

        if not found:
            newnode = {}
            newnode['renderer'] = 'focusedChild'
            newnode['name'] = r[2]["name"]
            newnode['clusters'] = []
            newnode['metadata'] = {}

            # Push newly discovered node
            for reg in infra['nodes']:
                if reg['displayName'] == 'EURO':
                    for node in reg['nodes']:
                        if node['displayName'] == service:
                            node['nodes'].append(newnode)

        # Check if connection already in dict
        found = False
        for reg in infra['nodes']:
            if reg['displayName'] == 'EURO':
                for node in reg['nodes']:
                    if node['displayName'] == service:
                        for c in node['connections']:
                            if c['source'] == r[0]["name"] and c['target'] == r[2]["name"]:
                                found = True

        if not found:
            newconn = {}
            newconn['source'] = r[0]["name"]
            newconn['target'] = r[2]["name"]
            newconn['metrics'] = {}
            newconn['metrics']['normal'] = 50000
            newconn['notices'] = []
            newconn['metadata'] = {}
            newconn['metadata']['streaming'] = 1

            # Push newly discovered node
            for reg in infra['nodes']:
                if reg['displayName'] == 'EURO':
                    for node in reg['nodes']:
                        if node['displayName'] == service:
                            node['connections'].append(newconn)


######################
print json.dumps(infra) #, ensure_ascii=False)
