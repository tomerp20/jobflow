FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source
COPY . .

EXPOSE 3001

CMD ["npm", "run", "dev"]
