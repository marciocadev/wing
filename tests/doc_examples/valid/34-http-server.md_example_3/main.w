// This file was auto generated from an example found in: 34-http-server.md_example_3
// Example metadata: {"valid":true}
bring cloud;

let api = new cloud.Api();

api.get("/items/:id/:value", inflight (req: cloud.ApiRequest): cloud.ApiResponse => {
  let itemId = req.vars.get("id");
  let itemValue = req.vars.get("value");
  log("Received itemId:{itemId}, itemValue:{itemValue}");
  return cloud.ApiResponse {
    status: 200,
    body: "Received itemId:{itemId}, itemValue:{itemValue}"
  };
});

