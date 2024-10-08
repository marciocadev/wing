# [lift_with_phase_ind.test.w](../../../../../tests/valid/lift_with_phase_ind.test.w) | compile | tf-aws

## inflight.$Closure1-1.cjs
```cjs
"use strict";
const $helpers = require("@winglang/sdk/lib/helpers");
const $macros = require("@winglang/sdk/lib/macros");
module.exports = function({ $ar, $math_Util }) {
  class $Closure1 {
    constructor($args) {
      const {  } = $args;
      const $obj = (...args) => this.handle(...args);
      Object.setPrototypeOf($obj, this);
      return $obj;
    }
    async handle() {
      $helpers.assert($helpers.eq($macros.__Array_at(false, $ar, 0), 1), "ar.at(0) == 1");
      const i = (await $math_Util.floor(((await $math_Util.random()) * $ar.length)));
      let x = $macros.__Array_at(false, $ar, i);
      $helpers.assert(((x >= 1) && (x <= 3)), "x >= 1 && x <= 3");
      x = $macros.__Array_at(false, $ar, ((1 - 1) + i));
      $helpers.assert(((x >= 1) && (x <= 3)), "x >= 1 && x <= 3");
      const mut_ar = $macros.__Array_copyMut(false, $ar, );
      $macros.__MutArray_push(false, mut_ar, 4);
    }
  }
  return $Closure1;
}
//# sourceMappingURL=inflight.$Closure1-1.cjs.map
```

## main.tf.json
```json
{
  "//": {
    "metadata": {
      "backend": "local",
      "stackName": "root"
    },
    "outputs": {}
  },
  "provider": {
    "aws": [
      {}
    ]
  }
}
```

## preflight.cjs
```cjs
"use strict";
const $stdlib = require('@winglang/sdk');
const $macros = require("@winglang/sdk/lib/macros");
const $platforms = ((s) => !s ? [] : s.split(';'))(process.env.WING_PLATFORMS);
const $outdir = process.env.WING_SYNTH_DIR ?? ".";
const $wing_is_test = process.env.WING_IS_TEST === "true";
const std = $stdlib.std;
const $helpers = $stdlib.helpers;
const $extern = $helpers.createExternRequire(__dirname);
const $PlatformManager = new $stdlib.platform.PlatformManager({platformPaths: $platforms});
class $Root extends $stdlib.std.Resource {
  constructor($scope, $id) {
    super($scope, $id);
    $helpers.nodeof(this).root.$preflightTypesMap = { };
    let $preflightTypesMap = {};
    const math = $stdlib.math;
    $helpers.nodeof(this).root.$preflightTypesMap = $preflightTypesMap;
    class $Closure1 extends $stdlib.std.AutoIdResource {
      _id = $stdlib.core.closureId();
      constructor($scope, $id, ) {
        super($scope, $id);
        $helpers.nodeof(this).hidden = true;
      }
      static _toInflightType() {
        return `
          require("${$helpers.normalPath(__dirname)}/inflight.$Closure1-1.cjs")({
            $ar: ${$stdlib.core.liftObject(ar)},
            $math_Util: ${$stdlib.core.liftObject($stdlib.core.toLiftableModuleType(globalThis.$ClassFactory.resolveType("@winglang/sdk.math.Util") ?? math.Util, "@winglang/sdk/math", "Util"))},
          })
        `;
      }
      get _liftMap() {
        return ({
          "handle": [
            [$stdlib.core.toLiftableModuleType(globalThis.$ClassFactory.resolveType("@winglang/sdk.math.Util") ?? math.Util, "@winglang/sdk/math", "Util"), [].concat(["floor"], ["random"])],
            [ar, [].concat(["at"], ["length"], ["copyMut"])],
          ],
          "$inflight_init": [
            [$stdlib.core.toLiftableModuleType(globalThis.$ClassFactory.resolveType("@winglang/sdk.math.Util") ?? math.Util, "@winglang/sdk/math", "Util"), []],
            [ar, []],
          ],
        });
      }
    }
    const ar = [1, 2, 3];
    globalThis.$ClassFactory.new("@winglang/sdk.std.Test", std.Test, this, "test:Use phase independent methods on lifted object", new $Closure1(this, "$Closure1"));
  }
}
const $APP = $PlatformManager.createApp({ outdir: $outdir, name: "lift_with_phase_ind.test", rootConstruct: $Root, isTestEnvironment: $wing_is_test, entrypointDir: process.env['WING_SOURCE_DIR'], rootId: process.env['WING_ROOT_ID'] });
$APP.synth();
//# sourceMappingURL=preflight.cjs.map
```

