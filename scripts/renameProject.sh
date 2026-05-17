#!/usr/bin/env bash

cd "$(dirname "$0")"

# CAUTION: this script will replace every occurrence of the word
# `fabricWebAuth` in the project folder with whatever argument
# you pass. Be very careful.

if [ $# -lt 1 ] ; then
  printf "Usage:\n$ ./renameProject.sh <my-project-name>\n"
  exit
fi

grep -rl fabricWebAuth ../ --exclude-dir={.git,node_modules} | xargs sed -i s/fabricWebAuth/$1/g
