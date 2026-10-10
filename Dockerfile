FROM node:24-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 80
CMD ["npm", "run", "dev", "--", "--port", "80"]

FROM development AS build
RUN npm run build

FROM nginx:stable-alpine AS production
COPY default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/checkin
EXPOSE 80
