# Petstore API (example collection)

1 request. Generated from the collection with `truspec docs`.

### Get pet by id

`GET {{baseUrl}}/pets/{{petId}}`

Fetch a single pet by its id.

**Spec operation:** `GET /pets/{id}`

**Query parameters**

| Query | Value |
|---|---|
| `expand` | `owner` |

**Asserts**

- status is 200
- `$.id` exists
- responds in under 1000ms

<details><summary>Example (cURL)</summary>

```bash
curl -X GET '{{baseUrl}}/pets/{{petId}}?expand=owner' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer {{token}}'
```

</details>

<sub>`get-pet.tspec.yaml`</sub>
