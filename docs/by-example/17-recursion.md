---
title: Recursion
id: recursion
slug: /recursion
sidebar_label: Recursion
description: Recursion with Wing
keywords: [Wing language, variadic]
image: /img/wing-by-example.png
---

```js playground example title="main.w"
let fact = (n: num): num => {
  if n == 0 {
    return 1;
  }
  return n * fact(n - 1);
};


log(fact(7));
```

```bash title="Wing console output"
# Run locally with wing console
wing it

5040
```