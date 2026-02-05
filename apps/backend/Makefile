project := opuspopuli
stage := dev

api_image := $(project)-$(stage)-api
users_image := $(project)-$(stage)-users
posts_image := $(project)-$(stage)-posts

image_tag = latest

# Build docker images
build:
	docker compose --file docker/dc-microservices.yaml --env-file docker/.env.docker.dev build

run: build
	docker compose --file docker/dc-apigateway.yaml --env-file docker/.env.docker.dev up -d
	docker compose --file docker/dc-microservices.yaml --env-file docker/.env.docker.dev up -d
