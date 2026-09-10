curl -X POST 'https://api.test/echo?t={{apiToken}}' \
  -H 'Authorization: Bearer {{apiToken}}' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "token": "{{apiToken}}"
}'
