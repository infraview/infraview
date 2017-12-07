FROM node:carbon

# Create app directory
WORKDIR /usr/src/app

# Copy both package.json AND package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Launch app
EXPOSE 2000
CMD [ "npm", "start" ]
