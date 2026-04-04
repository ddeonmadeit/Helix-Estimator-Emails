FROM node:20-slim

WORKDIR /app

COPY helix-scraper/ ./helix-scraper/

WORKDIR /app/helix-scraper

RUN npm ci --production
RUN mkdir -p output

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
