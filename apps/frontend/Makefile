project := opuspopuli
stage := dev

nextjs_image := $(project)-$(stage)-nextjs
nginx_image := $(project)-$(stage)-nginx

image_tag := latest

# Build docker images
build:
	docker compose --env-file .env.docker.dev build

run: build
	docker compose --env-file .env.docker.dev up -d
