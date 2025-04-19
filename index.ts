import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";


const CONTENTS_BUCKET_NAME = process.env.CONTENTS_BUCKET ?? "";

const contentsBucket = new aws.s3.BucketV2(CONTENTS_BUCKET_NAME);

export const bucketName = contentsBucket.id;
