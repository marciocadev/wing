import { Match, Template } from "aws-cdk-lib/assertions";
import { test, expect } from "vitest";
import { cloud, std } from "@winglang/sdk";
import { AwsCdkApp, awscdkSanitize } from "./util";
import { inflight } from "@winglang/sdk/lib/core";

const INFLIGHT_CODE = inflight(async (_, event) => {
  console.log("Received: ", event);
});

test("schedule behavior with rate", () => {
  // GIVEN
  const app = new AwsCdkApp();
  const schedule = new cloud.Schedule(app, "Schedule", {
    rate: std.Duration.fromMinutes(2),
  });
  schedule.onTick(INFLIGHT_CODE);
  const output = app.synth();

  // THEN
  const template = Template.fromJSON(JSON.parse(output));
  template.resourceCountIs("AWS::Events::Rule", 1);
  template.hasResourceProperties("AWS::Events::Rule", {
    ScheduleExpression: "rate(2 minutes)",
  });
  expect(awscdkSanitize(template)).toMatchSnapshot();
});

test("schedule behavior with cron", () => {
  // GIVEN
  const app = new AwsCdkApp();
  const schedule = new cloud.Schedule(app, "Schedule", {
    cron: "0/1 * * * *",
  });
  schedule.onTick(INFLIGHT_CODE);
  const output = app.synth();

  // THEN
  const template = Template.fromJSON(JSON.parse(output));
  template.resourceCountIs("AWS::Events::Rule", 1);
  template.hasResourceProperties("AWS::Events::Rule", {
    ScheduleExpression: "cron(0/1 * * * ? *)",
  });
  expect(awscdkSanitize(template)).toMatchSnapshot();
});

test("convert single dayOfWeek from Unix to AWS", () => {
  // GIVEN
  const app = new AwsCdkApp();
  const schedule = new cloud.Schedule(app, "Schedule", {
    cron: "* * * * 0",
  });
  schedule.onTick(INFLIGHT_CODE);
  const output = app.synth();

  // THEN
  const template = Template.fromJSON(JSON.parse(output));
  template.resourceCountIs("AWS::Events::Rule", 1);
  template.hasResourceProperties("AWS::Events::Rule", {
    ScheduleExpression: "cron(* * ? * 1 *)",
  });
  expect(awscdkSanitize(template)).toMatchSnapshot();
});

test("convert the range of dayOfWeek from Unix to AWS", () => {
  // GIVEN
  const app = new AwsCdkApp();
  const schedule = new cloud.Schedule(app, "Schedule", {
    cron: "* * * * 0-6",
  });
  schedule.onTick(INFLIGHT_CODE);
  const output = app.synth();

  // THEN
  const template = Template.fromJSON(JSON.parse(output));
  template.resourceCountIs("AWS::Events::Rule", 1);
  template.hasResourceProperties("AWS::Events::Rule", {
    ScheduleExpression: "cron(* * ? * 1-7 *)",
  });
  expect(awscdkSanitize(template)).toMatchSnapshot();
});

test("convert the list of dayOfWeek from Unix to AWS", () => {
  // GIVEN
  const app = new AwsCdkApp();
  const schedule = new cloud.Schedule(app, "Schedule", {
    cron: "* * * * 0,2,4,6",
  });
  schedule.onTick(INFLIGHT_CODE);
  const output = app.synth();

  // THEN
  const template = Template.fromJSON(JSON.parse(output));
  template.resourceCountIs("AWS::Events::Rule", 1);
  template.hasResourceProperties("AWS::Events::Rule", {
    ScheduleExpression: "cron(* * ? * 1,3,5,7 *)",
  });
  expect(awscdkSanitize(template)).toMatchSnapshot();
});

test("schedule with two functions", () => {
  // GIVEN
  const app = new AwsCdkApp();
  const schedule = new cloud.Schedule(app, "Schedule", {
    cron: "0/1 * * * *",
  });
  schedule.onTick(INFLIGHT_CODE);
  const output = app.synth();

  // THEN
  const template = Template.fromJSON(JSON.parse(output));
  template.hasResourceProperties("AWS::Events::Rule", {
    Targets: Match.arrayWith([
      Match.objectLike({
        Id: "Target0",
      }),
    ]),
  });
  expect(awscdkSanitize(template)).toMatchSnapshot();
});

test("schedule with rate and cron simultaneously", () => {
  // GIVEN
  const app = new AwsCdkApp();

  // THEN
  expect(
    () =>
      new cloud.Schedule(app, "Schedule", {
        rate: std.Duration.fromSeconds(30),
        cron: "0/1 * ? * *",
      })
  ).toThrow("rate and cron cannot be configured simultaneously.");
});

test("cron with more than five values", () => {
  // GIVEN
  const app = new AwsCdkApp();

  // THEN
  expect(
    () =>
      new cloud.Schedule(app, "Schedule", {
        cron: "0/1 * ? * * *",
      })
  ).toThrow("cron string must be in UNIX cron format");
});

test("schedule without rate or cron", () => {
  // GIVEN
  const app = new AwsCdkApp();

  // THEN
  expect(() => new cloud.Schedule(app, "Schedule")).toThrow(
    "rate or cron need to be filled."
  );
});

test("schedule with rate less than 1 minute", () => {
  // GIVEN
  const app = new AwsCdkApp();

  // THEN
  expect(
    () =>
      new cloud.Schedule(app, "Schedule", {
        rate: std.Duration.fromSeconds(30),
      })
  ).toThrow("rate can not be set to less than 1 minute.");
});

test("cron with day of month and day of week configured at the same time", () => {
  // GIVEN
  const app = new AwsCdkApp();

  // THEN
  expect(
    () =>
      new cloud.Schedule(app, "Schedule", {
        cron: "* * 1 * 1",
      })
  ).toThrow(
    "Cannot restrict both 'day-of-month' and 'day-of-week' in a cron expression, at least one must be '*'"
  );
});
