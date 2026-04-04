FROM node:20-slim

WORKDIR /app

COPY helix-scraper/package.json helix-scraper/package-lock.json ./helix-scraper/
RUN npm ci --prefix helix-scraper --production

COPY helix-scraper/ ./helix-scraper/
RUN mkdir -p helix-scraper/output

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "helix-scraper/server.js"]
