#!/usr/bin/env python3
"""Dump Sally's check_examples.py reference results to fixture.json for the node tests.
Run: python3 gen_fixture.py /workspace/gdt-trainer/lesson-02-composite-position"""
import sys, json, io, contextlib
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
with contextlib.redirect_stdout(io.StringIO()):
    import check_examples as ce
import numpy as np
out = {"checks_py": ce.checks, "cases": {}, "random": []}
for k, (devs, eu, el, ec) in ce.cases.items():
    r = ce.results[k]
    out["cases"][k] = dict(devs=[list(d) for d in devs], exp_up=eu, exp_lo=el, exp_code=ec,
        py_up=r["up"], py_lo=r["lo"], py_code=r["code"], py_fit=list(r["fit"]),
        scipy_lo=2 * ce.lower_fit_scipy(r["holes"]))
rng = np.random.default_rng(7)
for i in range(25):
    devs = [tuple(float(x) for x in rng.uniform(-0.15, 0.15, 4)) for _ in range(4)]
    h = ce.holes_from_dev(devs)
    out["random"].append(dict(devs=[list(d) for d in devs], py_r=ce.lower_fit(h)[0], scipy_r=ce.lower_fit_scipy(h)))
json.dump(out, open('fixture.json', 'w'), indent=1)
print('ok', ce.checks)
