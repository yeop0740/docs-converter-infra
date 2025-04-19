import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";


const CONTENTS_STAND_BY_QUEUE_NAME = process.env.CONTENTS_STAND_BY_QUEUE ?? "";
const CONTENTS_BUCKET_NAME = process.env.CONTENTS_BUCKET ?? "";

const contentsBucket = new aws.s3.BucketV2(CONTENTS_BUCKET_NAME);

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
