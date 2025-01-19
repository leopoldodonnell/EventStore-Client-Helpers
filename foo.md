docker pull docker.cloudsmith.io/eventstore/eventstore-preview/eventstoredb-ee:24.10.1-experimental-arm64-8.0-jammy

docker run --name esdb-node -d -p 2113:2113 -p 1113:1113 docker.cloudsmith.io/eventstore/eventstore-preview/eventstoredb-ee:24.10.1-experimental-arm64-8.0-jammy --insecure --run-projections=All