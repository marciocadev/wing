import { Duration } from "aws-cdk-lib";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue as SQSQueue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { App } from "./app";
import { std, cloud } from "@winglang/sdk";
import {
  Queue as AwsQueue,
  QueueSetConsumerHandler,
} from "@winglang/sdk/lib/shared-aws/queue";
import { isAwsCdkFunction } from "./function";

/**
 * AWS implementation of `cloud.Queue`.
 *
 * @inflight `@winglang/sdk.cloud.IQueueClient`
 */
export class Queue extends AwsQueue  {
  private readonly queue: SQSQueue;
  private readonly timeout: std.Duration;

  constructor(scope: Construct, id: string, props: cloud.QueueProps = {}) {
    super(scope, id, props);
    this.timeout = props.timeout ?? std.Duration.fromSeconds(30);

    const queueOpt = props.dlq
      ? {
          visibilityTimeout: props.timeout
            ? Duration.seconds(props.timeout?.seconds)
            : Duration.seconds(30),
          retentionPeriod: props.retentionPeriod
            ? Duration.seconds(props.retentionPeriod?.seconds)
            : Duration.hours(1),
          deadLetterQueue: {
            queue: SQSQueue.fromQueueArn(
              this,
              "DeadLetterQueue",
              AwsQueue.from(props.dlq.queue)?.queueArn!
            ),
            maxReceiveCount:
              props.dlq.maxDeliveryAttempts ?? cloud.DEFAULT_DELIVERY_ATTEMPTS,
          },
        }
      : {
          visibilityTimeout: props.timeout
            ? Duration.seconds(props.timeout?.seconds)
            : Duration.seconds(30),
          retentionPeriod: props.retentionPeriod
            ? Duration.seconds(props.retentionPeriod?.seconds)
            : Duration.hours(1),
        };

    this.queue = new SQSQueue(this, "Default", queueOpt);
  }

  public setConsumer(
    inflight: cloud.IQueueSetConsumerHandler,
    props: cloud.QueueSetConsumerOptions = {}
  ): cloud.Function {
    const functionHandler = QueueSetConsumerHandler.toFunctionHandler(inflight);

    const fn = new cloud.Function(
      // ok since we're not a tree root
      this.node.scope!,
      App.of(this).makeId(this, `${this.node.id}-SetConsumer`),
      functionHandler,
      {
        ...props,
        timeout: this.timeout,
      }
    );

    if (!isAwsCdkFunction(fn)) {
      throw new Error("Queue only supports creating IAwsCdkFunction right now");
    }

    const eventSource = new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 1,
      reportBatchItemFailures: true,
    });

    fn.awscdkFunction.addEventSource(eventSource);

    std.Node.of(this).addConnection({
      source: this,
      target: fn,
      name: "setConsumer()",
    });

    return fn;
  }

  public get queueArn(): string {
    return this.queue.queueArn;
  }

  public get queueName(): string {
    return this.queue.queueName;
  }

  public get queueUrl(): string {
    return this.queue.queueUrl;
  }
}
