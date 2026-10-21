# dockerfile for the camp status api (secure pipeline demo)
FROM node:24-alpine

WORKDIR /app

# install only production deps from the lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# app source (node_modules is blocked by .dockerignore)
COPY . .

# don't run the api as root
USER node

EXPOSE 3000
CMD ["node", "server.js"]
