// This file was auto generated from an example found in: 23-Json.md_example_3
// Example metadata: {"valid":true}
let x: num = 42;
let jsonNum = Json x;
log("{jsonNum}"); // 42

let chars = Array<str>["a", "b"];
let jsonChars = Json chars;
log("{jsonChars}"); // ["a","b"]

let jsonComplex = Json { "first": x, "second": chars };
log("{jsonComplex}"); // {"first": 42, "second": ["a","b"]}
