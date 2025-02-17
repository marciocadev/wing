import { ITerraformDependable, Lazy } from "cdktf";
import { Construct } from "constructs";
import { App } from "./app";
import { Topic as AWSTopic } from "./topic";
import { S3Bucket } from "../.gen/providers/aws/s3-bucket";
import { S3BucketCorsConfiguration } from "../.gen/providers/aws/s3-bucket-cors-configuration";

import {
  S3BucketNotification,
  S3BucketNotificationTopic,
} from "../.gen/providers/aws/s3-bucket-notification";

import { S3BucketPolicy } from "../.gen/providers/aws/s3-bucket-policy";
import { S3BucketPublicAccessBlock } from "../.gen/providers/aws/s3-bucket-public-access-block";
import { S3Object } from "../.gen/providers/aws/s3-object";
import * as cloud from "../cloud";
import * as core from "../core";
import {
  CaseConventions,
  NameOptions,
  ResourceNames,
} from "../shared/resource-names";
import { AwsInflightHost } from "../shared-aws";
import { BucketEventHandler, IAwsBucket } from "../shared-aws/bucket";
import { calculateBucketPermissions } from "../shared-aws/permissions";
import { IInflightHost } from "../std";

const EVENTS = {
  [cloud.BucketEventType.DELETE]: ["s3:ObjectRemoved:*"],
  [cloud.BucketEventType.CREATE]: ["s3:ObjectCreated:Put"],
  [cloud.BucketEventType.UPDATE]: ["s3:ObjectCreated:Post"],
};

/**
 * Bucket prefix provided to Terraform must be between 3 and 37 characters.
 *
 * Bucket names are allowed to contain lowercase alphanumeric characters and
 * dashes (-). We generate names without dots (.) to avoid some partial
 * restrictions on bucket names with dots.
 */
export const BUCKET_PREFIX_OPTS: NameOptions = {
  maxLen: 37,
  case: CaseConventions.LOWERCASE,
  disallowedRegex: /([^a-z0-9\-]+)/g,
  // add a dash to the end of the prefix to distinguish between the
  // Wing-generated portion of the name and the suffix generated by Terraform
  suffix: "-",
};

/**
 * AWS implementation of `cloud.Bucket`.
 *
 * @inflight `@winglang/sdk.aws.IAwsBucketClient`
 */
export class Bucket extends cloud.Bucket implements IAwsBucket {
  /** @internal */
  public static _toInflightType(): string {
    return core.InflightClient.forType(
      __filename
        .replace("target-tf-aws", "shared-aws")
        .replace("bucket", "bucket.inflight"),
      "BucketClient"
    );
  }

  private readonly bucket: S3Bucket;
  private readonly public: boolean;
  private readonly forceDestroy: boolean;
  private readonly notificationTopics: S3BucketNotificationTopic[] = [];
  private readonly notificationDependencies: ITerraformDependable[] = [];
  private readonly corsRules: cloud.BucketCorsOptions[] = [];
  private corsConfiguration?: S3BucketCorsConfiguration;

  constructor(scope: Construct, id: string, props: cloud.BucketProps = {}) {
    super(scope, id, props);

    this.public = props.public ?? false;
    this.forceDestroy = props.forceDestroy ?? false;

    this.bucket = createEncryptedBucket(this, this.public, this.forceDestroy);

    if (props.cors ?? true) {
      this.addCorsRule(
        props.corsOptions ?? cloud.DEFAULT_BUCKET_CORS_CONFIGURATION
      );
    }
  }

  public addCorsRule(value: cloud.BucketCorsOptions): void {
    this.corsRules.push(value);

    if (!this.corsConfiguration) {
      this.corsConfiguration = new S3BucketCorsConfiguration(
        this,
        `CorsConfiguration-${this.node.addr.slice(-8)}`,
        {
          bucket: this.bucket.id,
          corsRule: Lazy.anyValue({
            produce: () =>
              this.corsRules.map((rule) => {
                return {
                  allowed_headers: rule.allowedHeaders,
                  allowed_methods: rule.allowedMethods,
                  allowed_origins: rule.allowedOrigins,
                  max_age_seconds: rule.maxAge?.seconds,
                  expose_headers: rule.exposeHeaders,
                };
              }),
          }),
        }
      );
    }
  }

  public addObject(key: string, body: string): void {
    new S3Object(this, `S3Object-${key}`, {
      bucket: this.bucket.bucket,
      key,
      content: body,
    });
  }

  /** @internal */
  public get _liftMap(): core.LiftMap {
    return {
      [cloud.BucketInflightMethods.DELETE]: [],
      [cloud.BucketInflightMethods.GET]: [],
      [cloud.BucketInflightMethods.GET_JSON]: [],
      [cloud.BucketInflightMethods.LIST]: [],
      [cloud.BucketInflightMethods.PUT]: [],
      [cloud.BucketInflightMethods.PUT_JSON]: [],
      [cloud.BucketInflightMethods.PUBLIC_URL]: [],
      [cloud.BucketInflightMethods.EXISTS]: [],
      [cloud.BucketInflightMethods.TRY_GET]: [],
      [cloud.BucketInflightMethods.TRY_GET_JSON]: [],
      [cloud.BucketInflightMethods.TRY_DELETE]: [],
      [cloud.BucketInflightMethods.SIGNED_URL]: [],
      [cloud.BucketInflightMethods.METADATA]: [],
      [cloud.BucketInflightMethods.COPY]: [],
      [cloud.BucketInflightMethods.RENAME]: [],
    };
  }

  protected createTopicHandler(
    eventType: cloud.BucketEventType,
    inflight: cloud.IBucketEventHandler
  ): cloud.ITopicOnMessageHandler {
    return BucketEventHandler.toTopicOnMessageHandler(inflight, eventType);
  }

  protected createTopic(actionType: cloud.BucketEventType): cloud.Topic {
    const handler = super.createTopic(actionType);

    // TODO: remove this constraint by adding generic permission APIs to cloud.Function
    if (!(handler instanceof AWSTopic)) {
      throw new Error("Topic only supports creating tfaws.Function right now");
    }

    handler.addPermissionToPublish(this, "s3.amazonaws.com", this.bucket.arn);

    this.notificationTopics.push({
      id: `on-${actionType.toLowerCase()}-notification`,
      events: EVENTS[actionType],
      topicArn: handler.topicArn,
    });

    this.notificationDependencies.push(handler.permissions);

    return handler;
  }

  public _preSynthesize() {
    super._preSynthesize();
    if (this.notificationTopics.length) {
      new S3BucketNotification(this, `S3BucketNotification`, {
        bucket: this.bucket.id,
        topic: this.notificationTopics,
        dependsOn: this.notificationDependencies,
      });
    }
  }

  public onLift(host: IInflightHost, ops: string[]): void {
    if (!AwsInflightHost.isAwsInflightHost(host)) {
      throw new Error("Host is expected to implement `IAwsInfightHost`");
    }

    host.addPolicyStatements(
      ...calculateBucketPermissions(this.bucket.arn, ops)
    );

    // The bucket name needs to be passed through an environment variable since
    // it may not be resolved until deployment time.
    host.addEnvironment(this.envName(), this.bucket.bucket);
    super.onLift(host, ops);
  }

  /** @internal */
  public _liftedState(): Record<string, string> {
    return {
      $bucketName: `process.env["${this.envName()}"]`,
    };
  }

  private envName(): string {
    return `BUCKET_NAME_${this.node.addr.slice(-8)}`;
  }

  public get bucketArn(): string {
    return this.bucket.arn;
  }

  public get bucketName(): string {
    return this.bucket.bucket;
  }

  public get bucketDomainName(): string {
    return this.bucket.bucketDomainName;
  }
}

export function createEncryptedBucket(
  scope: Construct,
  isPublic: boolean,
  forceDestroy: boolean,
  name: string = "Default"
): S3Bucket {
  const bucketPrefix = ResourceNames.generateName(scope, BUCKET_PREFIX_OPTS);

  // names cannot begin with 'xn--'
  if (bucketPrefix.startsWith("xn--")) {
    throw new Error("AWS S3 bucket names cannot begin with 'xn--'.");
  }

  // names must begin with a letter or number
  if (!/^[a-z0-9]/.test(bucketPrefix)) {
    throw new Error("AWS S3 bucket names must begin with a letter or number.");
  }

  // names cannot end with '-s3alias' and must end with a letter or number,
  // but we do not need to handle these cases since we are generating the
  // prefix only

  const isTestEnvironment = App.of(scope).isTestEnvironment;

  const bucket = new S3Bucket(scope, name, {
    bucketPrefix,
    forceDestroy: !!isTestEnvironment || forceDestroy,
  });

  if (isPublic) {
    const publicAccessBlock = new S3BucketPublicAccessBlock(
      scope,
      "PublicAccessBlock",
      {
        bucket: bucket.bucket,
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }
    );
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: [`${bucket.arn}/*`],
        },
      ],
    };
    new S3BucketPolicy(scope, "PublicPolicy", {
      bucket: bucket.bucket,
      policy: JSON.stringify(policy),
      dependsOn: [publicAccessBlock],
    });
  }

  return bucket;
}
