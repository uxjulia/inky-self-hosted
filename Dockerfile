FROM node:22-alpine AS web-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
ARG VITE_INKY_APP_MODE=public
ENV VITE_INKY_APP_MODE=$VITE_INKY_APP_MODE
ARG VITE_INKY_LIBRARY_MODE=
ENV VITE_INKY_LIBRARY_MODE=$VITE_INKY_LIBRARY_MODE
ARG VITE_INKY_PUBLIC_READ_ONLY=
ENV VITE_INKY_PUBLIC_READ_ONLY=$VITE_INKY_PUBLIC_READ_ONLY
ARG VITE_INKY_DICTIONARY_TOOLS=
ENV VITE_INKY_DICTIONARY_TOOLS=$VITE_INKY_DICTIONARY_TOOLS
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libcairo2 libxml2 libxslt1.1 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/app ./backend/app
COPY --from=web-build /app/frontend/dist ./frontend/dist
COPY scripts/start-railway.sh ./scripts/start-railway.sh

ENV INKY_DATA_DIR=/data
ENV INKY_DATABASE_URL=sqlite:////data/inky.db
ENV INKY_STATIC_DIR=/app/frontend/dist
ENV INKY_PUBLIC_READ_ONLY=1
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "scripts/start-railway.sh"]
