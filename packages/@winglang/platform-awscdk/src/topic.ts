import { Topic as SNSTopic } from "aws-cdk-lib/aws-sns";
import { Queue as SQSQeueue } from "aws-cdk-lib/aws-sqs";
import {
  LambdaSubscription,
  SqsSubscription,
} from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { App } from "./app";
import { cloud, std } from "@winglang/sdk";
import {
  Topic as AwsTopic,
  TopicOnMessageHandler,
} from "@winglang/sdk/lib/shared-aws/topic";
import { Queue } from "./queue";
import { isAwsCdkFunction } from "./function";

/**
 * AWS Implementation of `cloud.Topic`.
 */
export class Topic extends AwsTopic {

  private readonly topic: SNSTopic;
  constructor(scope: Construct, id: string, props: cloud.TopicProps = {}) {
    super(scope, id, props);

    this.topic = new SNSTopic(this, "Topic");
  }

  public onMessage(
    inflight: cloud.ITopicOnMessageHandler,
    props: cloud.TopicOnMessageOptions = {}
  ): cloud.Function {
    const functionHandler = TopicOnMessageHandler.toFunctionHandler(inflight);

    const fn = new cloud.Function(
      this.node.scope!, // ok since we're not a tree root
      App.of(this).makeId(this, `${this.node.id}-OnMessage`),
      functionHandler,
      props
    );

    if (!isAwsCdkFunction(fn)) {
      throw new Error(
        "Expected function to implement 'IAwsCdkFunction' method"
      );
    }

    const subscription = new LambdaSubscription(fn.awscdkFunction);
    this.topic.addSubscription(subscription);

    std.Node.of(this).addConnection({
      source: this,
      target: fn,
      name: "onMessage()",
    });

    return fn;
  }

  public subscribeQueue(queue: cloud.Queue): void {
    if (!(queue instanceof Queue)) {
      throw new Error(
        "'subscribeQueue' allows only tfaws.Queue to be subscribed to the Topic"
      );
    }

    const baseTopic = SNSTopic.fromTopicArn(this, "BaseTopic", this.topicArn);
    const baseQueue = SQSQeueue.fromQueueArn(this, "BaseQueue", queue.queueArn);
    baseTopic.addSubscription(new SqsSubscription(baseQueue));
  }

  /** @internal */
  public get _topic(): SNSTopic {
    return this.topic;
  }

  public get topicArn(): string {
    return this.topic.topicArn;
  }

  public get topicName(): string {
    return this.topic.topicName;
  }
}
