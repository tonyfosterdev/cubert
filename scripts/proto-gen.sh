#!/bin/bash
set -e

echo "=== Generating Proto Types ==="

# Generate for body
echo "Generating body proto types..."
cd packages/body
npx proto-loader-gen-types \
  --longs=String \
  --enums=String \
  --defaults \
  --oneofs \
  --grpcLib=@grpc/grpc-js \
  --outDir=src/grpc/generated \
  ../../proto/cubert.proto
cd ../..

# Generate for brain
echo "Generating brain proto types..."
cd packages/brain
npx proto-loader-gen-types \
  --longs=String \
  --enums=String \
  --defaults \
  --oneofs \
  --grpcLib=@grpc/grpc-js \
  --outDir=src/grpc/generated \
  ../../proto/cubert.proto
cd ../..

echo "=== Proto Generation Complete ==="
