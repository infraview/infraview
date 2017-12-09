## Infrastructure monitoring tool

## Setup

* Install **NodeJS** and **MongoDB** (version 3.4 or higher is required, so `$graphLokkup` can be used). For MongoDB 3.4 you need to enable `db.adminCommand( { setFeatureCompatibilityVersion: "3.4" } )`

* Install requirements
```
npm install
```

* Configure settings under **config.json**, based on config.json.example.

* Start MongoDB service

* Run the application
```
npm start
```


## Run it with docker

* Install and configure **MongoDB** (version 3.4 or higher is required, so `$graphLokkup` can be used). For MongoDB 3.4 you need to enable `db.adminCommand( { setFeatureCompatibilityVersion: "3.4" } )`

* Configure settings under **config.json**, based on config.json.example. Make sure you update **mongo_url** so it can be accessible from the container.

* Build image
```
docker build .
```

* Run the image
```
docker run -p 2000:2000 -d IMAGE_ID
```


## Run it with docker-compose

This will start both the app and database.
```
docker-compose up
```
