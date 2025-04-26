import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as archive from "@pulumi/archive";
import * as dotenv from "dotenv";

dotenv.config();

const CONTENTS_STAND_BY_QUEUE_NAME = process.env.CONTENTS_STAND_BY_QUEUE ?? "";
const CONTENTS_BUCKET_NAME = process.env.CONTENTS_BUCKET ?? "";
const LAMBDA_BUCKET_NAME = process.env.LAMBDA_BUCKET ?? "";
const CONTENTS_CONSUMER_LAMBDA_NAME = process.env.CONTENTS_CONSUMER_LAMBDA ?? "";
const ORIGINAL_BUCKET_PREFIX = process.env.ORIGINAL_BUCKET_PREFIX ?? "";
const CONVERTED_BUCKET_PREFIX = process.env.CONVERTED_BUCKET_PREFIX ?? "";

const contentsBucket = new aws.s3.BucketV2(CONTENTS_BUCKET_NAME);

const lambdaBucket = new aws.s3.BucketV2(LAMBDA_BUCKET_NAME);

const lambdaBucketVersioning = new aws.s3.BucketVersioningV2(`${LAMBDA_BUCKET_NAME}-versioning`, {
    bucket: lambdaBucket.id,
    versioningConfiguration: {
        status: "Enabled",
    },
});

const mockObjectFile = archive.getFile({
    type: "zip",
    sourceFile: "asset/mock-contents-consumer-lambda.py",
    outputPath: `${CONTENTS_CONSUMER_LAMBDA_NAME}-${pulumi.getStack()}.zip`,
});

const mockObject = new aws.s3.BucketObject(CONTENTS_CONSUMER_LAMBDA_NAME, {
    bucket: lambdaBucketVersioning.id,
    source: new pulumi.asset.FileArchive(`${CONTENTS_CONSUMER_LAMBDA_NAME}-${pulumi.getStack()}.zip`),
    contentType: "application/zip",
});

const contentsConsumerLambdaServiceRole = aws.iam.getPolicyDocument({
    statements: [{
        effect: "Allow",
        principals: [{
            type: "Service",
            identifiers: ["lambda.amazonaws.com"],
        }],
        actions: ["sts:AssumeRole"],
    }],
});

const contentsConsumerLambdaRole = new aws.iam.Role(CONTENTS_CONSUMER_LAMBDA_NAME, {
    name: 'lambda-role',
    assumeRolePolicy: contentsConsumerLambdaServiceRole.then(assumeRole => assumeRole.json),
});

const contentsConsumerLambda = new aws.lambda.Function(CONTENTS_CONSUMER_LAMBDA_NAME, {
    s3Bucket: lambdaBucket.id,
    s3Key:`${CONTENTS_CONSUMER_LAMBDA_NAME}-${pulumi.getStack()}`,
    role: contentsConsumerLambdaRole.arn,
    handler: "consumer.handle",
    architectures: ["arm64"],
    runtime: aws.lambda.Runtime.Python3d12,
    memorySize: 1024,
    timeout: 10,
    publish: true,
    environment: {
        variables: {
            ORIGINAL_BUCKET_NAME: contentsBucket.id.apply(id => `${id}${ORIGINAL_BUCKET_PREFIX}`),
            CONVERTED_BUCKET_NAME: contentsBucket.id.apply(id => `${id}${CONVERTED_BUCKET_PREFIX}`),
        }
    }
});

const contentsStandByQueue = new aws.sqs.Queue(CONTENTS_STAND_BY_QUEUE_NAME, {
    policy: aws.iam.getPolicyDocumentOutput({
        statements: [{
            effect: "Allow",
            principals: [{
                type: "*",
                identifiers: ["*"],
            }],
            actions: ["sqs:SendMessage"],
            resources: [`arn:aws:sqs:*:*:${CONTENTS_STAND_BY_QUEUE_NAME}-${pulumi.getStack()}`],
            conditions: [{
                test: "ArnEquals",
                variable: "aws:SourceArn",
                values: [contentsBucket.arn]
            }]
        }],
    }).apply(policy => policy.json),
});

const contentsCreatedBucketNotification = new aws.s3.BucketNotification("contents-created-bucket-notification", {
    bucket: contentsBucket.id,
    queues: [
        {
            id: 'contents-created-event',
            queueArn: contentsStandByQueue.arn,
            events: ["s3:ObjectCreated:*"],
            filterPrefix: "original/",
        }
    ],
});

export const bucketName = contentsBucket.id;
