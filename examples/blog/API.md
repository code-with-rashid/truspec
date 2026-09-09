# Blog API (example collection)

3 requests. Generated from the collection with `truspec docs`.

## Requests

| | Request | Endpoint |
|---|---|---|
| `POST` | [Create post](#create-post) | `{{baseUrl}}/posts` |
| `GET` | [Get post](#get-post) | `{{baseUrl}}/posts/{{postId}}` |
| `GET` | [List posts](#list-posts) | `{{baseUrl}}/posts` |

## `posts/`

### Create post

`POST {{baseUrl}}/posts`

**Spec operation:** `POST /posts`

**Body**

```json
{
  "title": "Hello world",
  "body": "First post.",
  "userId": 1
}
```

**Asserts**

- `{"type":"status","equals":201}`
- `{"type":"jsonpath","path":"$.id","exists":true}`

<details><summary>Example (cURL)</summary>

```bash
curl -X POST '{{baseUrl}}/posts' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "title": "Hello world",
  "body": "First post.",
  "userId": 1
}'
```

</details>

<sub>`posts/create-post.tspec.yaml`</sub>

### Get post

`GET {{baseUrl}}/posts/{{postId}}`

**Spec operation:** `GET /posts/{id}`

**Asserts**

- `{"type":"status","equals":200}`
- `{"type":"jsonpath","path":"$.title","exists":true}`

<details><summary>Example (cURL)</summary>

```bash
curl -X GET '{{baseUrl}}/posts/{{postId}}' \
  -H 'Accept: application/json'
```

</details>

<sub>`posts/get-post.tspec.yaml`</sub>

### List posts

`GET {{baseUrl}}/posts`

**Spec operation:** `GET /posts`

**Asserts**

- `{"type":"status","equals":200}`
- `{"type":"jsonpath","path":"$[0].id","exists":true}`

<details><summary>Example (cURL)</summary>

```bash
curl -X GET '{{baseUrl}}/posts' \
  -H 'Accept: application/json'
```

</details>

<sub>`posts/list-posts.tspec.yaml`</sub>
