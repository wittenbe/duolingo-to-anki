FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY prompt ./prompt

USER node
CMD ["node", "--import", "tsx", "src/poll.ts"]
