import * as fs from "fs";
import * as inspector from "inspector";
import { Construct } from "constructs";
import { test, expect, describe } from "vitest";
import {
  Api,
  Bucket,
  Function,
  IBucketClient,
  IFunctionClient,
  IFunctionHandler,
  OnDeploy,
  Service,
} from "../../src/cloud";
import { inflight, lift } from "../../src/core";
import { Simulator } from "../../src/simulator";
import { ITestRunnerClient, Test, TestResult, TraceType } from "../../src/std";
import { State } from "../../src/target-sim";
import { SimApp } from "../sim-app";
import { mkdtemp } from "../util";

describe("lock mechanism", () => {
  test("locks the state dir so only one simulator can be active at a time", async () => {
    const app = new SimApp();

    const stateDir = mkdtemp();

    const sim1 = await app.startSimulator(stateDir);
    await expect(app.startSimulator(stateDir)).rejects.toThrow(
      "Another instance of the simulator is already running on the same state directory.",
    );
    await sim1.stop();
  });

  test("releases the lock after stopping the simulator", async () => {
    const app = new SimApp();

    const stateDir = mkdtemp();

    const sim1 = await app.startSimulator(stateDir);
    await sim1.stop();

    await expect(
      (async () => {
        const sim2 = await app.startSimulator(stateDir);
        await sim2.stop();
      })(),
    ).resolves.not.toThrow();
  });
});

const NOOP = inflight(async () => {});
const NOOP2 = inflight(async () => {
  console.log("noop2");
});
const OK_200 = inflight(async () => ({ status: 200 }));

describe("run single test", () => {
  test("test not found", async () => {
    const app = new SimApp({ isTestEnvironment: true });
    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    await expect(testRunner.runTest("test_not_found")).rejects.toThrowError(
      'No test found at path "test_not_found"',
    );
    await sim.stop();
  });

  test("happy path", async () => {
    const app = new SimApp({ isTestEnvironment: true });
    makeTest(
      app,
      "test",
      inflight(async () => console.log("hi")),
    );
    app.synth();
    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    const result = await testRunner.runTest("root/test");
    await sim.stop();
    expect(sanitizeResult(result)).toMatchSnapshot();
  });

  test("test failure", async () => {
    const app = new SimApp({ isTestEnvironment: true });
    makeTest(
      app,
      "test",
      inflight(async () => {
        console.log("I am about to fail");
        throw new Error("test failed");
      }),
    );

    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    const result = await testRunner.runTest("root/test");
    await sim.stop();
    expect(sanitizeResult(result)).toMatchSnapshot();
  });

  test("not a function", async () => {
    const app = new SimApp({ isTestEnvironment: true });
    new Bucket(app, "test");

    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    await expect(testRunner.runTest("root/test")).rejects.toThrowError(
      'No test found at path "root/test"',
    );
    await sim.stop();
  });
});

describe("run all tests", () => {
  test("no tests", async () => {
    const app = new SimApp({ isTestEnvironment: true });
    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    const tests = await testRunner.listTests();
    await sim.stop();
    expect(tests).toEqual([]);
  });

  test("single test", async () => {
    const app = new SimApp({ isTestEnvironment: true });
    makeTest(
      app,
      "test",
      inflight(async () => console.log("hi")),
    );

    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    const results = await runAllTests(testRunner);
    await sim.stop();
    expect(results.map(sanitizeResult)).toMatchSnapshot();
  });

  test("multiple tests", async () => {
    class Root extends Construct {
      constructor(scope: Construct, id: string) {
        super(scope, id);
        makeTest(
          this,
          "test",
          inflight(async () => console.log("hi")),
        );
        makeTest(
          this,
          "test:bla",
          inflight(async () => console.log("hi")),
        );
        makeTest(
          this,
          "test:blue",
          inflight(async () => console.log("hi")),
        );
      }
    }
    const app = new SimApp({ isTestEnvironment: true, rootConstruct: Root });

    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    const results = await runAllTests(testRunner);
    await sim.stop();
    expect(results.length).toEqual(3);
    expect(results.map((r) => r.path).sort()).toStrictEqual([
      "root/Default/test",
      "root/Default/test:bla",
      "root/Default/test:blue",
    ]);
  });

  test("tests with same name in different scopes", async () => {
    class ConstructWithTest extends Construct {
      constructor(scope: Construct, id: string) {
        super(scope, id);
        makeTest(
          this,
          "test",
          inflight(async () => console.log("hi")),
        );
      }
    }

    class Root extends Construct {
      constructor(scope: Construct, id: string) {
        super(scope, id);

        makeTest(
          this,
          "test",
          inflight(async () => console.log("hi")),
        );
        new ConstructWithTest(this, "scope1");
        new ConstructWithTest(this, "scope2");
      }
    }
    const app = new SimApp({ isTestEnvironment: true, rootConstruct: Root });

    const sim = await app.startSimulator();
    const testRunner = sim.getResource(
      "/cloud.TestRunner",
    ) as ITestRunnerClient;
    const results = await runAllTests(testRunner);
    await sim.stop();
    expect(results.length).toEqual(3);
    expect(results.map((r) => r.path).sort()).toStrictEqual([
      "root/Default/scope1/test",
      "root/Default/scope2/test",
      "root/Default/test",
    ]);
  });
});

test("await client is a no-op", async () => {
  const app = new SimApp();
  new Bucket(app, "test");
  const sim = await app.startSimulator();
  const bucketClient = sim.getResource("/test");
  expect(await bucketClient).toBe(bucketClient);
  await sim.stop();
});

test("calling an invalid method returns an error to the client", async () => {
  // as opposed to, say, crashing the server
  const app = new SimApp();
  new Bucket(app, "test");
  const sim = await app.startSimulator();
  const bucketClient = sim.getResource("/test");
  await expect(bucketClient.invalidMethod()).rejects.toThrowError(
    /Method "invalidMethod" not found on resource/,
  );
  await sim.stop();
});

test("provides raw tree data", async () => {
  const app = new SimApp();
  makeTest(
    app,
    "test",
    inflight(async () => console.log("hi")),
  );
  const sim = await app.startSimulator();
  const treeData = sim.tree().rawData();
  await sim.stop();
  expect(treeData).toBeDefined();
  expect(treeData).toMatchSnapshot();
});

test("unable to resolve token during initialization", async () => {
  const app = new SimApp();
  const state = new State(app, "State");
  const bucket = new Bucket(app, "Bucket");
  bucket.addObject("url.txt", state.token("my_token"));

  let error;
  try {
    await app.startSimulator();
  } catch (e) {
    error = e;
  }
  expect(error).toBeDefined();
  expect(error.message).toMatch(
    /Failed to start resources: \"root\/Bucket\", "root\/Bucket\/Policy\"/,
  );
});

describe("in-place updates", () => {
  test("no change", async () => {
    const stateDir = mkdtemp();

    const app = new SimApp();
    new Bucket(app, "Bucket1");

    const sim = await app.startSimulator(stateDir);
    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
    ]);

    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
    ]);

    const app2 = new SimApp();
    new Bucket(app2, "Bucket1");

    const app2Dir = app2.synth();

    await sim.update(app2Dir);
    expect(updateTrace(sim)).toStrictEqual({
      added: [],
      deleted: [],
      updated: [],
    });

    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "Update: 0 added, 0 updated, 0 deleted",
    ]);

    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
    ]);
    await sim.stop();
  });

  test("add", async () => {
    const stateDir = mkdtemp();

    const app = new SimApp();

    new Bucket(app, "Bucket1");
    const sim = await app.startSimulator(stateDir);
    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
    ]);
    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
    ]);

    const app2 = new SimApp();
    new Bucket(app2, "Bucket1");
    new Bucket(app2, "Bucket2");

    const app2Dir = app2.synth();
    await sim.update(app2Dir);
    expect(updateTrace(sim)).toStrictEqual({
      added: ["root/Bucket2", "root/Bucket2/Policy"],
      deleted: [],
      updated: [],
    });

    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
      "root/Bucket2",
      "root/Bucket2/Policy",
    ]);
    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "Update: 2 added, 0 updated, 0 deleted",
      "root/Bucket2 started",
      "root/Bucket2/Policy started",
    ]);

    await sim.stop();
  });

  test("delete", async () => {
    const stateDir = mkdtemp();

    const app = new SimApp();
    new Bucket(app, "Bucket1");
    new Bucket(app, "Bucket2");
    const sim = await app.startSimulator(stateDir);
    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
      "root/Bucket2",
      "root/Bucket2/Policy",
    ]);
    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "root/Bucket2 started",
      "root/Bucket2/Policy started",
    ]);

    const app2 = new SimApp();
    new Bucket(app2, "Bucket1");

    const app2Dir = app2.synth();
    await sim.update(app2Dir);
    expect(updateTrace(sim)).toStrictEqual({
      added: [],
      deleted: ["root/Bucket2", "root/Bucket2/Policy"],
      updated: [],
    });

    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
    ]);

    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "root/Bucket2 started",
      "root/Bucket2/Policy started",
      "Update: 0 added, 0 updated, 2 deleted",
      "root/Bucket2/Policy stopped",
      "root/Bucket2 stopped",
    ]);

    await sim.stop();
  });

  test("update", async () => {
    const stateDir = mkdtemp();

    const app = new SimApp();
    new Bucket(app, "Bucket1");
    const sim = await app.startSimulator(stateDir);
    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
    ]);
    expect(sim.getResourceConfig("root/Bucket1").props.public).toBeFalsy();
    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
    ]);

    const app2 = new SimApp();
    new Bucket(app2, "Bucket1", { public: true });

    const app2Dir = app2.synth();
    await sim.update(app2Dir);
    expect(updateTrace(sim)).toStrictEqual({
      added: [],
      deleted: [],
      updated: ["root/Bucket1"],
    });

    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
    ]);

    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "Update: 0 added, 1 updated, 0 deleted",
      "root/Bucket1/Policy stopped",
      "root/Bucket1 stopped",
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
    ]);

    expect(sim.getResourceConfig("root/Bucket1").props.public).toBeTruthy();

    await sim.stop();
  });

  test("add resource that depends on an existing resource", async () => {
    const stateDir = mkdtemp();

    const app = new SimApp();
    new Bucket(app, "Bucket1");

    const sim = await app.startSimulator(stateDir);

    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
    ]);

    expect(sim.listResources()).toEqual([
      "root/Bucket1",
      "root/Bucket1/Policy",
    ]);
    expect(sim.getResourceConfig("root/Bucket1").props.public).toBeFalsy();

    const app2 = new SimApp();
    const bucket1 = new Bucket(app2, "Bucket1");
    const api = new Api(app2, "Api");
    bucket1.addObject("url.txt", api.url);

    const handler = inflight(async () => process.env.API_URL);
    new Function(app2, "Function", handler, {
      env: { API_URL: api.url },
    });

    const app2Dir = app2.synth();

    await sim.update(app2Dir);
    expect(updateTrace(sim)).toStrictEqual({
      added: [
        "root/Api",
        "root/Api/Endpoint",
        "root/Api/Policy",
        "root/Function",
      ],
      deleted: [],
      updated: ["root/Bucket1"],
    });

    expect(simTraces(sim)).toStrictEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "Update: 4 added, 1 updated, 0 deleted",
      "root/Bucket1/Policy stopped",
      "root/Bucket1 stopped",
      "root/Api started",
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "root/Api/Endpoint started",
      "root/Api/Policy started",
      "root/Function started",
    ]);

    expect(sim.listResources()).toEqual([
      "root/Api",
      "root/Api/Endpoint",
      "root/Api/Policy",
      "root/Bucket1",
      "root/Bucket1/Policy",
      "root/Function",
    ]);

    const bucketClient = sim.getResource("root/Bucket1") as IBucketClient;
    const urlFromBucket = await bucketClient.get("url.txt");
    expect(urlFromBucket.startsWith("http://127.0.0")).toBeTruthy();

    const functionClient = sim.getResource("root/Function") as IFunctionClient;
    const ret = await functionClient.invoke();
    expect(ret).toEqual(urlFromBucket);
  });

  test("retained resource is not removed", async () => {
    const app = new SimApp();
    const api1 = new Api(app, "Api");
    const bucket1 = new Bucket(app, "Bucket");
    bucket1.addObject("url.txt", api1.url);

    const stateDir = mkdtemp();
    const sim = await app.startSimulator(stateDir);

    const urlBeforeUpdate = await sim.getResource("root/Bucket").get("url.txt");

    // remove the state directory otherwise Api reuses the port
    fs.rmdirSync(sim.getResourceStateDir("/Api"), { recursive: true });

    const app2 = new SimApp();
    const api2 = new Api(app2, "Api");
    const bucket2 = new Bucket(app2, "Bucket", { public: true }); // <-- causing the update to be updated because we are deleting the state dirtectory, so we want the file to be uploaded again.
    bucket2.addObject("url.txt", api2.url);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(updateTrace(sim)).toStrictEqual({
      added: [],
      deleted: [],
      updated: ["root/Bucket"],
    });

    const urlAfterUpdate = await sim.getResource("root/Bucket").get("url.txt");
    expect(urlBeforeUpdate).toStrictEqual(urlAfterUpdate);
  });

  test("dependent resource is replaced when a dependency is replaced", async () => {
    const app = new SimApp();
    const myApi = new Api(app, "Api1");
    const myBucket = new Bucket(app, "Bucket1");

    // BUCKET depends on API
    myBucket.addObject("url.txt", myApi.url);

    const stateDir = mkdtemp();
    const sim = await app.startSimulator(stateDir);

    expect(simTraces(sim)).toEqual([
      "root/Api1 started",
      "root/Api1/Endpoint started",
      "root/Api1/Policy started",
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
    ]);

    // now lets change some configuration of Api1. we expect the bucket to be replaced as well

    const app2 = new SimApp();
    const myApi2 = new Api(app2, "Api1", { cors: true });
    const myBucket2 = new Bucket(app2, "Bucket1");
    myBucket2.addObject("url.txt", myApi2.url);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(updateTrace(sim)).toStrictEqual({
      added: [],
      deleted: [],
      updated: ["root/Api1"], // TODO: shouldn't Bucket also be listed here?
    });

    expect(simTraces(sim)).toEqual([
      "root/Api1 started",
      "root/Api1/Endpoint started",
      "root/Api1/Policy started",
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "Update: 0 added, 1 updated, 0 deleted",
      "root/Api1/Endpoint stopped",
      "root/Api1/Policy stopped",
      "root/Bucket1/Policy stopped",
      "root/Bucket1 stopped",
      "root/Api1 stopped",
      "root/Api1 started",
      "root/Api1/Endpoint started",
      "root/Api1/Policy started",
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
    ]);

    await sim.stop();
  });

  test("token value is changed across an update", async () => {
    const app = new SimApp();
    const stateKey = "my_value";

    const myState = new State(app, "State");

    new Service(
      app,
      "Service",
      lift({ myState, stateKey })
        .grant({ myState: ["set"] })
        .inflight(async (ctx) => {
          await ctx.myState.set(`${ctx.stateKey}`, "bang" as any);
        }),
      { env: { VER: "1" } },
    );

    new Function(
      app,
      "Function",
      inflight(async (ctx) => process.env.MY_VALUE),
      {
        env: { MY_VALUE: myState.token(stateKey) },
      },
    );

    const sim = await app.startSimulator();

    const fn = sim.getResource("root/Function") as IFunctionClient;
    const result = await fn.invoke();
    expect(result).toEqual("bang");

    // okay, now we are ready to update
    const app2 = new SimApp();

    const myState2 = new State(app2, "State");

    new Service(
      app2,
      "Service",
      lift({ myState: myState2, stateKey })
        .grant({ myState: ["set"] })
        .inflight(async (ctx) => {
          await ctx.myState.set(`${ctx.stateKey}`, "bing" as any);
        }),
      { env: { VER: "2" } },
    );

    new Function(
      app2,
      "Function",
      inflight(async (ctx) => process.env.MY_VALUE),
      {
        env: { MY_VALUE: myState.token(stateKey) },
      },
    );

    await sim.update(app2.synth());

    expect(simTraces(sim)).toEqual([
      "root/State started",
      "root/State.my_value = bang",
      "root/Service started",
      "root/Function started",
      "Update: 0 added, 1 updated, 0 deleted",
      "root/Service stopped",
      "root/State.my_value = bing",
      "root/Service started",
    ]);
  });

  test("Construct dependencies are taken into account", async () => {
    const app = new SimApp();

    const bucket = new Bucket(app, "Bucket1");

    new OnDeploy(app, "OnDeploy", NOOP, {
      executeAfter: [bucket],
    });

    const sim = await app.startSimulator();

    const app2 = new SimApp();
    const bucket2 = new Bucket(app2, "Bucket1", { public: true });
    new OnDeploy(app2, "OnDeploy", NOOP, {
      executeAfter: [bucket2],
    });

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(simTraces(sim)).toEqual([
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "root/OnDeploy/Function started",
      "root/OnDeploy started",
      "Update: 0 added, 2 updated, 0 deleted",
      "root/Bucket1/Policy stopped",
      "root/OnDeploy stopped",
      "root/Bucket1 stopped",
      "root/Bucket1 started",
      "root/Bucket1/Policy started",
      "root/OnDeploy started",
    ]);
  });

  test("cloud.Function is not replaced if its inflight code does not change", async () => {
    const app = new SimApp();
    new Function(app, "Function", NOOP);

    const sim = await app.startSimulator();

    const app2 = new SimApp();
    new Function(app2, "Function", NOOP);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(simTraces(sim)).toEqual([
      "root/Function started",
      "Update: 0 added, 0 updated, 0 deleted",
    ]);
  });

  test("cloud.Function is replaced if its inflight code changes", async () => {
    const outdir = mkdtemp();
    console.log("outdir", outdir);

    const app = new SimApp({ outdir });
    new Function(app, "Function", NOOP);

    const sim = await app.startSimulator();

    // cloud.Function bundles its code in the background. Because of this, it's
    // possible that the code later in this test that synthesizes a version of
    // the app with new inflight code could run before the simulator's bundling starts,
    // in which case no Function replacement would be necessary.
    //
    // Since we want to test the case where the Function is replaced, we need to
    // make sure that the bundling finishes before we synthesize the new app.
    // So we invoke the function to block until the bundling finishes.
    const fn = sim.getResource("/Function") as IFunctionClient;
    await fn.invoke();

    const app2 = new SimApp({ outdir });
    new Function(app2, "Function", NOOP2);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(simTraces(sim)).toEqual([
      "root/Function started",
      "Update: 0 added, 1 updated, 0 deleted",
      "root/Function stopped",
      "root/Function started",
    ]);
  });

  test("cloud.Service is not replaced if its inflight code does not change", async () => {
    const app = new SimApp();
    new Service(app, "Service", NOOP);

    const sim = await app.startSimulator();

    const app2 = new SimApp();
    new Service(app2, "Service", NOOP);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(simTraces(sim)).toEqual([
      "root/Service started",
      "Update: 0 added, 0 updated, 0 deleted",
    ]);
  });

  test("cloud.Service is replaced if its inflight code changes", async () => {
    const outdir = mkdtemp();

    const app = new SimApp({ outdir });
    new Service(app, "Service", NOOP);

    const sim = await app.startSimulator();

    const app2 = new SimApp({ outdir });
    new Service(app2, "Service", NOOP2);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(simTraces(sim)).toEqual([
      "root/Service started",
      "Update: 0 added, 1 updated, 0 deleted",
      "root/Service stopped",
      "root/Service started",
    ]);
  });

  test("cloud.OnDeploy is always replaced", async () => {
    const app = new SimApp();
    new OnDeploy(app, "OnDeploy", NOOP);

    const sim = await app.startSimulator();

    const app2 = new SimApp();
    new OnDeploy(app2, "OnDeploy", NOOP);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    expect(simTraces(sim)).toEqual([
      "root/OnDeploy/Function started",
      "root/OnDeploy started",
      "Update: 0 added, 1 updated, 0 deleted",
      "root/OnDeploy stopped",
      "root/OnDeploy started",
    ]);
  });

  test("cloud.Api routes are updated", { retry: 3 }, async () => {
    const app = new SimApp();
    const api = new Api(app, "Api");
    api.get("/hello", OK_200);

    const sim = await app.startSimulator();
    const apiUrl = sim.getResourceConfig("/Api").attrs.url as string;
    const response1 = await fetch(`${apiUrl}/hello`, { method: "GET" });
    expect(response1.status).toEqual(200);

    const app2 = new SimApp();
    const api2 = new Api(app2, "Api");
    api2.get("/world", OK_200);

    const app2Dir = app2.synth();
    await sim.update(app2Dir);

    // /hello route should be removed
    const response2 = await fetch(`${apiUrl}/hello`, { method: "GET" });
    expect(response2.status).toEqual(404);

    // /world route should be added
    const response3 = await fetch(`${apiUrl}/world`, { method: "GET" });
    expect(response3.status).toEqual(200);

    expect(simTraces(sim)).toEqual([
      "root/Api started",
      "root/Api/Endpoint started",
      "root/Api/OnRequestHandler0 started",
      "root/Api/Policy started",
      "root/Api/ApiEventMapping0 started",
      "Update: 0 added, 2 updated, 0 deleted",
      "root/Api/Endpoint stopped",
      "root/Api/Policy stopped",
      "root/Api/ApiEventMapping0 stopped",
      "root/Api stopped",
      "root/Api started",
      "root/Api/Endpoint started",
      "root/Api/Policy started",
      "root/Api/ApiEventMapping0 started",
    ]);
  });
});

test("debugging inspector inherited by sandbox", async () => {
  const app = new SimApp();
  const handler = inflight(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (require("inspector").url() === undefined) {
      throw new Error("inspector not available");
    }
  });
  new OnDeploy(app, "OnDeploy", handler);

  inspector.open(0);
  const sim = await app.startSimulator();
  await sim.stop();

  expect(
    sim
      .listTraces()
      .some((t) => t.data.message.startsWith("Debugger listening on ")),
  );
});

test("tryGetResource returns undefined if the resource not found", async () => {
  const app = new SimApp();
  const sim = await app.startSimulator();
  expect(sim.tryGetResource("bang")).toBeUndefined();
  expect(sim.tryGetResourceConfig("bing")).toBeUndefined();
});

function makeTest(scope: Construct, id: string, handler: IFunctionHandler) {
  return new Test(scope, id, handler);
}

function sanitizeResult(result: TestResult): TestResult {
  let error: string | undefined;
  if (result.error) {
    error = result.error.split("\n")[0];
  }

  return {
    path: result.path,
    pass: result.pass,
    error,
    traces: result.traces.map((trace) => ({
      ...trace,
      timestamp: "<TIMESTAMP>",
    })),
  };
}

async function runAllTests(runner: ITestRunnerClient): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const testName of await runner.listTests()) {
    results.push(await runner.runTest(testName));
  }
  return results;
}

function simTraces(s: Simulator) {
  return s
    .listTraces()
    .filter((t) => t.type === TraceType.SIMULATOR)
    .map((t) => t.data.message);
}

function updateTrace(s: Simulator) {
  return s
    .listTraces()
    .find((t) => t.type === TraceType.SIMULATOR && t.data.update)?.data.update;
}
