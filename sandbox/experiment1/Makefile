%.json: %.yaml
	perl -MJSON -MYAML=LoadFile -le 'print JSON->new->pretty->encode(LoadFile shift)' $< > $@

export NODE_PATH=/usr/local/lib/node_modules

all: english.html legalese.html safe.mdh

HANDLEBARS=handlebars
HANDLEBARS=../../src/bin/hb

YAML=orig

.SECONDARY:

%.mdh: %.mustache $(YAML).json
	$(HANDLEBARS) --file=$< $(YAML).json > $@

%.mdm: %.mustache $(YAML).yaml
	mustache main.yaml $< > $@

%.html: %.mdh
	markdown $< | perl -nle 'print if /\S/' > $@

legalese.html: legalese.mdh
	perl -nle 'print if /\S/' $< > $@

clean: 
	rm -f *.html *.md? *.txt *.json *~
