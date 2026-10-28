# Build the web app
FROM node:20-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --include=dev
COPY client/ ./
RUN npm run build

# Run the server, which also serves the built web app
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_FILE=/data/events.json
COPY server/package*.json server/
RUN npm install --prefix server --omit=dev
COPY server/ server/
COPY --from=client /app/client/dist client/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
HEALTHCHECK CMD wget -qO- http://localhost:3001/healthz || exit 1
CMD ["node", "server/index.js"]
