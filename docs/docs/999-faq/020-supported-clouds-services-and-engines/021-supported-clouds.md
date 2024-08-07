---
title: Which clouds are supported by Wing?
sidebar_label: Clouds
id: supported-clouds
keywords: [faq, supported clouds, winglang, Wing programming language, Wing language, AWS, GCP, Azure]
description: Build applications on any cloud with Winglang. Fully supported on AWS, partially supported on GCP and Azure. Check our roadmap for future updates!
---

Winglang was built from the ground up to make it an ideal choice for building applications on any cloud. Every app has access to the Wing SDK, a set of batteries-included resources that represent cloud services that are common to most major cloud providers for common use cases.

Since Wing is in early stages of development, the Wing SDK supports each cloud with different levels of maturity:
* AWS - Fully supported. If you are able to compile your Wing code for the simulator, you should be able to compile it for AWS as well (with the Terraform provisioning engine).
* GCP - Partial support. Not all Wing code that compiles for the simulator will compile for GCP. 
* Azure - Partial support. Not all Wing code that compiles for the simulator will compile for Azure. 

We are working hard on filling the support gap between the different clouds -- check out our [roadmap](https://www.winglang.io/contributing/status) for more details. If there are other clouds you would like supported, please let us know through our GitHub or Discord!

Beyond the common set of cloud resources in the SDK, you can create resources for any other possible cloud by importing a [CDKTF](https://github.com/hashicorp/terraform-cdk) library corresponding to any given Terraform provider.

## How to check specific service support for each cloud
Check out our [compatibility matrix](https://www.winglang.io/docs/api/standard-library/compatibility-matrix) to see which services are supported now on different clouds.

## How to deploy on the different clouds
Check out our [CLI reference](https://www.winglang.io/docs/tools/cli) for instructions on how to deploy your wing code on the different clouds.
In the future, compiling for the different clouds could be supported through the GUI of the Wing Console as well (you can track progress in this [issue](https://github.com/winglang/wing/issues/2051)).

