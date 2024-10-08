bring cloud;
bring http;
bring util;
bring expect;

let publicBucket = new cloud.Bucket(public: true) as "publicBucket";
let privateBucket = new cloud.Bucket() as "privateBucket";

test "publicUrl" {
  let assertThrows = (expected: str, block: (): void) => {
    let var error = false;
    try {
      block();
    } catch actual {
      expect.equal(actual, expected);
      error = true;
    }
    assert(error);
  };

  let BUCKET_NOT_PUBLIC_ERROR = "Cannot provide public url for a non-public bucket";

  publicBucket.put("file1.txt", "Foo");
  privateBucket.put("file2.txt", "Bar");

  let publicUrl = publicBucket.publicUrl("file1.txt");
  assert(publicUrl != "");
  assert(http.get(publicUrl).body ==  "Foo");

  assertThrows(BUCKET_NOT_PUBLIC_ERROR, () => {
    privateBucket.publicUrl("file2.txt");
  });
}
