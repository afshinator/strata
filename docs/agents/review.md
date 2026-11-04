# Review

## A test must be able to fail

Green means nothing until the test has been seen red. Break the implementation on
purpose, run the test, and put the mutation and its failing output in the PR.

The fixture is the usual culprit. A test for Rust comment stripping passed with
the feature deleted: its commented import began with `//` and the regex anchors at
`^[ \t]*`, so the line could never match either way. A block comment at column
zero made the same mutation fail one test.

## A resolution change is measured on a real repository

The suite indexes fixtures only. A Python fallback using exact lookup where the
resolver also matches on suffix took finance-hub from 27 edges to 0 with 92 tests
green. Run `npm run reference` before believing a resolution change, and treat a
language that loses edges as the finding. A repo that has moved is not one.

## A number names its source

A count quoted from an earlier turn carries the commit and tree state it came
from. `finance-hub 533 edges` was repeated for several turns after that repo moved
to `b62c6bf` with 9 dirty files. `npm run reference` prints `head` and `dirty` for
this reason.
